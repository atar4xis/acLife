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
	err = withQuota(ctx, tx, owner, touched, measureJournal, func() error {
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

func SyncJournal(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req types.JournalSyncRequest
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	if req.Hash != "" {
		syncJournalHash(w, r, user.UUID, req.Hash)
		return
	}

	if len(req.Buckets) == 0 || len(req.Buckets) > constants.MaxJournalSyncBuckets || len(req.Records) > constants.MaxRequestRecords {
		utils.SendBadRequest(w)
		return
	}

	wanted := make(map[string]struct{}, len(req.Buckets))
	for _, b := range req.Buckets {
		if !slices.Contains(journalBuckets, b) {
			utils.SendBadRequest(w)
			return
		}
		wanted[b] = struct{}{}
	}

	res, err := diffJournalBuckets(r.Context(), user.UUID, slices.Sorted(maps.Keys(wanted)), req.Records)
	if err != nil {
		utils.LogError("SyncJournal", "diffJournalBuckets", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[types.JournalSyncResponse]{Success: true, Data: res})
}

type journalSend struct {
	id     string
	bucket string
	added  bool
}

func diffJournalBuckets(ctx context.Context, owner string, buckets []string, cached []types.CachedRecord) (types.JournalSyncResponse, error) {
	res := types.JournalSyncResponse{
		SyncDiff: types.SyncDiff[types.EncryptedRecord]{
			Added:   []types.EncryptedRecord{},
			Updated: []types.EncryptedRecord{},
			Deleted: []string{},
		},
		Remaining: []string{},
	}

	ranges := make([]string, len(buckets))
	args := make([]any, 0, 2*len(buckets)+1)
	args = append(args, owner)
	for i, b := range buckets {
		ranges[i] = "(id >= ? AND id < ?)"
		args = append(args, b, nextBucket(b))
	}
	rows, err := database.Query(ctx,
		`SELECT id, updated_at FROM journal_items WHERE owner = ? AND (`+strings.Join(ranges, " OR ")+`) ORDER BY id`,
		args...,
	)
	if err != nil {
		return res, err
	}
	defer func() { _ = rows.Close() }()

	server := make(map[string]int64)
	serverIDs := make(map[string][]string, len(buckets))
	for rows.Next() {
		var id string
		var updatedAt time.Time
		if err := rows.Scan(&id, &updatedAt); err != nil {
			return res, err
		}
		server[id] = updatedAt.UnixMilli()
		serverIDs[journalBucket(id)] = append(serverIDs[journalBucket(id)], id)
	}
	if err := rows.Err(); err != nil {
		return res, err
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
		items, err := fetchJournalItems(ctx, owner, chunk)
		if err != nil {
			return res, err
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
			if next := start + i + 1; sent >= journalSyncBytes && next < len(send) {
				res.Remaining = buckets[slices.Index(buckets, send[next].bucket):]
				return res, nil
			}
		}
	}
	return res, nil
}

func fetchJournalItems(ctx context.Context, owner string, chunk []journalSend) (map[string]types.EncryptedRecord, error) {
	ids := make([]string, len(chunk))
	for i, s := range chunk {
		ids[i] = s.id
	}
	query, args, err := database.In(`SELECT id, data, updated_at FROM journal_items WHERE owner = ? AND id IN (?)`, owner, ids)
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

func syncJournalHash(w http.ResponseWriter, r *http.Request, owner, hash string) {
	rows, err := database.Query(r.Context(), `SELECT id, updated_at FROM journal_items WHERE owner = ?`, owner)
	if err != nil {
		utils.LogError("syncJournalHash", "Query", err)
		utils.SendInternalError(w)
		return
	}
	defer func() { _ = rows.Close() }()

	var all []string
	byBucket := make(map[string][]string)
	for rows.Next() {
		var id string
		var updatedAt time.Time
		if err := rows.Scan(&id, &updatedAt); err != nil {
			utils.LogError("syncJournalHash", "Scan", err)
			utils.SendInternalError(w)
			return
		}
		line := hashLine(id, updatedAt)
		all = append(all, line)
		bucket := journalBucket(id)
		byBucket[bucket] = append(byBucket[bucket], line)
	}
	if err := rows.Err(); err != nil {
		utils.LogError("syncJournalHash", "Rows", err)
		utils.SendInternalError(w)
		return
	}

	res := types.JournalHashResponse{Match: bucketHash(all) == hash}
	if !res.Match {
		var table strings.Builder
		for _, b := range journalBuckets {
			table.WriteString(bucketHash(byBucket[b])[:constants.JournalHashChars])
		}
		res.Table = table.String()
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[types.JournalHashResponse]{Success: true, Data: res})
}

// measureJournal returns the quota bytes of the owner's journal items among ids.
func measureJournal(ctx context.Context, tx *sql.Tx, owner string, ids []any) (int64, error) {
	var used int64
	err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(OCTET_LENGTH(data)), 0) FROM journal_items WHERE owner = ? AND id IN (?`+strings.Repeat(",?", len(ids)-1)+`)`,
		append([]any{owner}, ids...)...,
	).Scan(&used)
	return used, err
}
