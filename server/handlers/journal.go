package handlers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strings"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/session"
	"acLife/stream"
	"acLife/types"
	"acLife/utils"
)

var (
	journalSyncBytes int64 = constants.MaxJournalSyncBytes
	journalBuckets         = func() []string {
		names := make([]string, 1<<(4*constants.JournalBucketChars))
		for i := range names {
			names[i] = fmt.Sprintf("%0*x", constants.JournalBucketChars, i)
		}
		return names
	}()
)

// JournalChange is one entry of a journal/save request body.
type JournalChange = types.RecordChange[types.EncryptedRecord]

type journalUpsert struct {
	id        string
	data      []byte
	updatedAt time.Time
	change    stream.Change
}

func SaveJournal(w http.ResponseWriter, r *http.Request) {
	saveChanges(w, r, "SaveJournal", applyJournalChanges, func(originClientID string, applied []stream.Change) stream.Message {
		return stream.Changed("journal", originClientID, applied)
	})
}

func applyJournalChanges(ctx context.Context, tx *sql.Tx, owner string, changes []JournalChange) ([]stream.Change, error) {
	collected, err := collectChanges(changes, strings.ToLower, func(c JournalChange, id string) (journalUpsert, error) {
		decoded, err := base64.StdEncoding.DecodeString(c.Record.Data)
		if err != nil || len(decoded) > constants.MaxJournalLen {
			return journalUpsert{}, errBadChanges
		}

		return journalUpsert{
			id:        id,
			data:      decoded,
			updatedAt: time.UnixMilli(c.Record.UpdatedAt),
			change:    stream.Change{Type: c.Type, ID: id, Data: c.Record.Data, UpdatedAt: c.Record.UpdatedAt},
		}, nil
	})
	if err != nil {
		return nil, err
	}
	deletedIDs, upserts, touched := collected.deleted, collected.upserts, collected.touched

	var kept []journalUpsert
	err = withQuota(ctx, tx, owner, personalBytes, touched, measureJournal, func() error {
		if len(deletedIDs) > 0 {
			query, args, err := database.In(`DELETE FROM journal_items WHERE owner = ? AND id IN (?)`, owner, touched[:len(deletedIDs)])
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, query, args...); err != nil {
				return err
			}
		}

		if len(upserts) == 0 {
			return nil
		}

		valueArgs := make([]any, 0, len(upserts)*4)
		for _, up := range upserts {
			valueArgs = append(valueArgs, up.id, owner, up.data, up.updatedAt)
		}

		if _, err := tx.ExecContext(ctx, `
		INSERT INTO journal_items (id, owner, data, updated_at)
		VALUES (?, ?, ?, ?)`+strings.Repeat(", (?, ?, ?, ?)", len(upserts)-1)+`
		ON DUPLICATE KEY UPDATE
			data = IF(owner = VALUES(owner) AND VALUES(updated_at) >= updated_at, VALUES(data), data),
			updated_at = IF(owner = VALUES(owner) AND VALUES(updated_at) >= updated_at, VALUES(updated_at), updated_at)
		`, valueArgs...); err != nil {
			return err
		}

		query, args, err := database.In(`SELECT id, updated_at FROM journal_items WHERE owner = ? AND id IN (?)`, owner, touched[len(deletedIDs):])
		if err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, query, args...)
		if err != nil {
			return err
		}
		defer func() { _ = rows.Close() }()

		current := make(map[string]int64, len(upserts))
		for rows.Next() {
			var id string
			var updatedAt time.Time
			if err := rows.Scan(&id, &updatedAt); err != nil {
				return err
			}
			current[id] = updatedAt.UnixMilli()
		}
		if err := rows.Err(); err != nil {
			return err
		}

		for _, up := range upserts {
			if current[up.id] == up.updatedAt.UnixMilli() {
				kept = append(kept, up)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	applied := make([]stream.Change, 0, len(touched))
	for _, id := range deletedIDs {
		applied = append(applied, stream.Change{Type: "deleted", ID: id})
	}
	for _, up := range kept {
		applied = append(applied, up.change)
	}
	return applied, nil
}

func nextBucket(bucket string) string {
	last := bucket[len(bucket)-1]
	if last == '9' {
		last = 'a' - 1
	}
	return bucket[:len(bucket)-1] + string(last+1)
}

func journalBucket(id string) string {
	if len(id) < constants.JournalBucketChars {
		return ""
	}
	return id[:constants.JournalBucketChars]
}

type journalRow struct {
	id        string
	updatedAt int64
}

type journalSource struct {
	table  string
	keyCol string
	key    string
}

func SyncJournal(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req types.JournalSyncRequest
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	records := 0
	for _, part := range req.Parts {
		records += len(part.Records)
	}
	if records > constants.MaxRequestRecords {
		utils.SendBadRequest(w)
		return
	}

	// the byte budget is shared by all parts, so later parts get what earlier ones left
	budget := journalSyncBytes
	syncParts(w, r, "SyncJournal", kindJournal, req.Parts,
		func(part types.JournalSyncPart) string { return part.Space },
		func(ctx context.Context, space string, part types.JournalSyncPart) (any, error) {
			src := journalSource{"journal_items", "owner", user.UUID}
			if space != "" {
				src = journalSource{"share_records", "space", space}
			}

			if part.Hash != "" {
				return syncJournalHash(ctx, src, part.Hash)
			}

			buckets, err := parseJournalBuckets(part.Buckets)
			if err != nil {
				return nil, err
			}

			res, sent, err := diffJournalBuckets(ctx, src, buckets, part.Records, budget)
			budget -= sent
			return res, err
		},
	)
}

func parseJournalBuckets(requested []string) ([]string, error) {
	if len(requested) == 0 || len(requested) > constants.MaxJournalSyncBuckets {
		return nil, errBadSync
	}

	wanted := make(map[string]struct{}, len(requested))
	for _, b := range requested {
		if !slices.Contains(journalBuckets, b) {
			return nil, errBadSync
		}
		wanted[b] = struct{}{}
	}

	return slices.Sorted(maps.Keys(wanted)), nil
}

type journalSend struct {
	id     string
	bucket string
	added  bool
}

func diffJournalBuckets(ctx context.Context, src journalSource, buckets []string, cached []types.CachedRecord, limit int64) (types.JournalSyncResponse, int64, error) {
	res := types.JournalSyncResponse{
		SyncDiff: types.SyncDiff[types.EncryptedRecord]{
			Added:   []types.EncryptedRecord{},
			Updated: []types.EncryptedRecord{},
			Deleted: []string{},
		},
		Remaining: []string{},
	}
	if limit <= 0 {
		res.Remaining = buckets
		return res, 0, nil
	}

	ranges := make([]string, len(buckets))
	args := make([]any, 0, 2*len(buckets)+1)
	args = append(args, src.key)
	for i, b := range buckets {
		ranges[i] = "(id >= ? AND id < ?)"
		args = append(args, b, nextBucket(b))
	}
	rows, err := database.Query(ctx,
		`SELECT id, updated_at FROM `+src.table+` WHERE `+src.keyCol+` = ? AND (`+strings.Join(ranges, " OR ")+`) ORDER BY id`,
		args...,
	)
	if err != nil {
		return res, 0, err
	}
	defer func() { _ = rows.Close() }()

	server := make(map[string]int64)
	serverIDs := make(map[string][]string, len(buckets))
	for rows.Next() {
		var id string
		var updatedAt time.Time
		if err := rows.Scan(&id, &updatedAt); err != nil {
			return res, 0, err
		}
		server[id] = updatedAt.UnixMilli()
		serverIDs[journalBucket(id)] = append(serverIDs[journalBucket(id)], id)
	}
	if err := rows.Err(); err != nil {
		return res, 0, err
	}

	client := make(map[string]int64, len(cached))
	for _, c := range cached {
		id := strings.ToLower(c.ID)
		if slices.Contains(buckets, journalBucket(id)) {
			client[id] = c.Timestamp
		}
	}
	for _, id := range slices.Sorted(maps.Keys(client)) {
		if _, ok := server[id]; !ok {
			res.Deleted = append(res.Deleted, id)
		}
	}

	var send []journalSend
	for _, b := range buckets {
		for _, id := range serverIDs[b] {
			ts, known := client[id]
			if server[id] > ts {
				send = append(send, journalSend{id: id, bucket: b, added: !known})
			}
		}
	}

	var sent int64
	for start := 0; start < len(send); start += constants.JournalFetchChunk {
		chunk := send[start:min(start+constants.JournalFetchChunk, len(send))]
		items, err := fetchJournalItems(ctx, src, chunk)
		if err != nil {
			return res, sent, err
		}

		for i, s := range chunk {
			ev, ok := items[s.id]
			if !ok {
				continue
			}
			if s.added {
				res.Added = append(res.Added, ev)
			} else {
				res.Updated = append(res.Updated, ev)
			}

			sent += int64(len(ev.Data))
			if next := start + i + 1; sent >= limit && next < len(send) {
				res.Remaining = buckets[slices.Index(buckets, send[next].bucket):]
				return res, sent, nil
			}
		}
	}
	return res, sent, nil
}

func fetchJournalItems(ctx context.Context, src journalSource, chunk []journalSend) (map[string]types.EncryptedRecord, error) {
	ids := make([]string, len(chunk))
	for i, s := range chunk {
		ids[i] = s.id
	}
	query, args, err := database.In(`SELECT id, data, updated_at FROM `+src.table+` WHERE `+src.keyCol+` = ? AND id IN (?)`, src.key, ids)
	if err != nil {
		return nil, err
	}
	rows, err := database.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	items := make(map[string]types.EncryptedRecord, len(chunk))
	for rows.Next() {
		var id string
		var data []byte
		var updatedAt time.Time
		if err := rows.Scan(&id, &data, &updatedAt); err != nil {
			return nil, err
		}
		items[id] = types.EncryptedRecord{ID: id, Data: base64.StdEncoding.EncodeToString(data), UpdatedAt: updatedAt.UnixMilli()}
	}
	return items, rows.Err()
}

func syncJournalHash(ctx context.Context, src journalSource, hash string) (types.JournalHashResponse, error) {
	rows, err := database.Query(ctx, `SELECT id, updated_at FROM `+src.table+` WHERE `+src.keyCol+` = ?`, src.key)
	if err != nil {
		return types.JournalHashResponse{}, err
	}
	defer func() { _ = rows.Close() }()

	var all []string
	byBucket := make(map[string][]string)
	for rows.Next() {
		var id string
		var updatedAt time.Time
		if err := rows.Scan(&id, &updatedAt); err != nil {
			return types.JournalHashResponse{}, err
		}
		line := hashLine(id, updatedAt)
		all = append(all, line)
		bucket := journalBucket(id)
		byBucket[bucket] = append(byBucket[bucket], line)
	}
	if err := rows.Err(); err != nil {
		return types.JournalHashResponse{}, err
	}

	res := types.JournalHashResponse{Match: bucketHash(all) == hash}
	if !res.Match {
		var table strings.Builder
		for _, b := range journalBuckets {
			table.WriteString(bucketHash(byBucket[b])[:constants.JournalHashChars])
		}
		res.Table = table.String()
	}

	return res, nil
}

// measureJournal returns the quota bytes of the owner's journal items among ids.
func measureJournal(ctx context.Context, tx *sql.Tx, owner string, ids []any) (int64, error) {
	var used int64
	err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(OCTET_LENGTH(data)), 0) FROM journal_items WHERE owner = ? AND id IN (`+placeholders(len(ids))+`)`,
		append([]any{owner}, ids...)...,
	).Scan(&used)
	return used, err
}
