package handlers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/session"
	"acLife/stream"
	"acLife/types"
	"acLife/utils"
)

var errForbidden = errors.New("not allowed in this space")

const sharedHashQuery = `
		SELECT srb.bucket_id, sr.id, sr.updated_at
		FROM share_records sr
		JOIN share_record_buckets srb ON srb.space = sr.space AND srb.record_id = sr.id
		WHERE sr.space = ? AND srb.bucket_id IN (%s)`

const sharedRangeQuery = `
		SELECT sr.id, sr.data, sr.updated_at
		FROM share_records sr
		WHERE sr.space = ? AND EXISTS (
			SELECT 1 FROM share_record_buckets srb
			WHERE srb.space = sr.space AND srb.record_id = sr.id AND srb.bucket_id IN (%s)
		)`

type SharedChange = types.RecordChange[types.EncryptedEvent]

type sharedUpsert struct {
	id        string
	data      []byte
	updatedAt time.Time
	buckets   [][]byte
	change    stream.Change
}

func SaveShared(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil)

	spaceID := strings.ToLower(r.URL.Query().Get("space"))
	var recipients []string
	saveScoped(w, r, "SaveShared", "space:"+spaceID,
		func(ctx context.Context, tx *sql.Tx, changes []SharedChange) ([]stream.Change, error) {
			applied, users, err := applySharedChanges(ctx, tx, user.UUID, spaceID, changes)
			recipients = users
			return applied, err
		},
		func(originClientID string, applied []stream.Change) {
			stream.PublishTo(recipients, stream.SpaceUpdated(spaceID, originClientID, applied))
		},
	)
}

// parseSharedUpsert decodes one change, journal records carry no buckets and calendar records need at least one.
func parseSharedUpsert(sp access, c SharedChange, id string) (sharedUpsert, error) {
	maxLen := constants.MaxEventLen
	if sp.Kind == kindJournal {
		maxLen = constants.MaxJournalLen
	}

	decoded, err := base64.StdEncoding.DecodeString(c.Record.Data)
	if err != nil || len(decoded) > maxLen {
		return sharedUpsert{}, errBadChanges
	}

	up := sharedUpsert{
		id:        id,
		data:      decoded,
		updatedAt: time.UnixMilli(c.Record.UpdatedAt),
		change:    stream.Change{Type: c.Type, ID: id, Data: c.Record.Data, UpdatedAt: c.Record.UpdatedAt},
	}

	if sp.Kind == kindJournal {
		if len(c.Record.Buckets) != 0 {
			return sharedUpsert{}, errBadChanges
		}
		return up, nil
	}

	if len(c.Record.Buckets) == 0 || len(c.Record.Buckets) > constants.MaxEventBuckets {
		return sharedUpsert{}, errBadChanges
	}
	for _, b := range c.Record.Buckets {
		bucketID, err := base64.StdEncoding.DecodeString(b)
		if err != nil || len(bucketID) != constants.BucketIDLen {
			return sharedUpsert{}, errBadChanges
		}
		up.buckets = append(up.buckets, bucketID)
	}
	return up, nil
}

func applySharedChanges(ctx context.Context, tx *sql.Tx, user, spaceID string, changes []SharedChange) ([]stream.Change, []string, error) {
	sp, err := spaceAccess(ctx, tx, spaceID, user)
	if err != nil {
		return nil, nil, err
	}
	if !sp.canWrite() {
		return nil, nil, errForbidden
	}

	collected, err := collectChanges(changes, strings.ToLower, func(c SharedChange, id string) (sharedUpsert, error) {
		return parseSharedUpsert(sp, c, id)
	})
	if err != nil {
		return nil, nil, err
	}
	deletedIDs, upserts := collected.deleted, collected.upserts

	// members of an item space may edit the shared records but not add or delete any
	updateOnly := !sp.isOwner && sp.Scope == scopeItem
	if updateOnly && len(deletedIDs) > 0 {
		return nil, nil, errForbidden
	}

	var winningUpserts []sharedUpsert
	err = withQuota(ctx, tx, sp.Owner, sharedBytes, collected.touched, measureSpace(sp.ID), func() error {
		if updateOnly {
			if err := requireExisting(ctx, tx, sp.ID, collected.touched); err != nil {
				return err
			}
		}

		if len(deletedIDs) > 0 {
			query, args, err := database.In("DELETE FROM share_records WHERE space = ? AND id IN (?)", sp.ID, collected.touched[:len(deletedIDs)])
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

		winningUpserts, err = upsertSharedRecords(ctx, tx, sp.ID, upserts, collected.touched[len(deletedIDs):])
		return err
	})
	if database.IsForeignKeyViolation(err) {
		return nil, nil, errNoSpace
	}
	if err != nil {
		return nil, nil, err
	}

	recipients, err := ownerAndUsers(ctx, tx, sp.Owner, "SELECT user FROM share_members WHERE space = ? AND status = 'accepted'", sp.ID)
	if err != nil {
		return nil, nil, err
	}

	applied := make([]stream.Change, 0, len(collected.touched))
	for _, id := range deletedIDs {
		applied = append(applied, stream.Change{Type: "deleted", ID: id})
	}
	for _, up := range winningUpserts {
		applied = append(applied, up.change)
	}
	return applied, recipients, nil
}

// requireExisting fails with errForbidden unless every id is already a record of the space.
func requireExisting(ctx context.Context, tx *sql.Tx, spaceID string, ids []any) error {
	query, args, err := database.In("SELECT COUNT(*) FROM share_records WHERE space = ? AND id IN (?)", spaceID, ids)
	if err != nil {
		return err
	}

	var found int
	if err := tx.QueryRowContext(ctx, query, args...).Scan(&found); err != nil {
		return err
	}
	if found != len(ids) {
		return errForbidden
	}
	return nil
}

func upsertSharedRecords(ctx context.Context, tx *sql.Tx, spaceID string, upserts []sharedUpsert, ids []any) ([]sharedUpsert, error) {
	valueArgs := make([]any, 0, len(upserts)*4)
	for _, up := range upserts {
		valueArgs = append(valueArgs, spaceID, up.id, up.data, up.updatedAt)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO share_records (space, id, data, updated_at)
		VALUES (?, ?, ?, ?)`+strings.Repeat(", (?, ?, ?, ?)", len(upserts)-1)+`
		ON DUPLICATE KEY UPDATE
			data = IF(VALUES(updated_at) >= updated_at, VALUES(data), data),
			updated_at = IF(VALUES(updated_at) >= updated_at, VALUES(updated_at), updated_at)
		`, valueArgs...); err != nil {
		return nil, err
	}

	query, args, err := database.In("SELECT id, updated_at FROM share_records WHERE space = ? AND id IN (?)", spaceID, ids)
	if err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	current := make(map[string]int64, len(upserts))
	for rows.Next() {
		var id string
		var updatedAt time.Time
		if err := rows.Scan(&id, &updatedAt); err != nil {
			return nil, err
		}
		current[id] = updatedAt.UnixMilli()
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// an older write loses against the stored row, so only upserts that won are kept and replicated
	var winningUpserts []sharedUpsert
	for _, up := range upserts {
		if current[up.id] == up.updatedAt.UnixMilli() {
			winningUpserts = append(winningUpserts, up)
		}
	}
	return winningUpserts, replaceSharedBuckets(ctx, tx, spaceID, winningUpserts)
}

func replaceSharedBuckets(ctx context.Context, tx *sql.Tx, spaceID string, winningUpserts []sharedUpsert) error {
	var idsWithBuckets []any
	var values []string
	args := []any{}
	for _, up := range winningUpserts {
		if len(up.buckets) == 0 {
			continue
		}
		idsWithBuckets = append(idsWithBuckets, up.id)
		for _, b := range up.buckets {
			values = append(values, "(?, ?, ?)")
			args = append(args, spaceID, up.id, b)
		}
	}
	if len(idsWithBuckets) == 0 {
		return nil
	}

	query, delArgs, err := database.In("DELETE FROM share_record_buckets WHERE space = ? AND record_id IN (?)", spaceID, idsWithBuckets)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, query, delArgs...); err != nil {
		return err
	}

	_, err = tx.ExecContext(ctx, "INSERT IGNORE INTO share_record_buckets (space, record_id, bucket_id) VALUES "+strings.Join(values, ","), args...)
	return err
}

func missingRecords(ctx context.Context, space string, ids []string) (types.EventMissingResponse, error) {
	if space == "" || len(ids) == 0 {
		return types.EventMissingResponse{}, errBadSync
	}

	wanted := make([]any, len(ids))
	for i, id := range ids {
		if !utils.IsUUID(id) {
			return types.EventMissingResponse{}, errBadSync
		}
		wanted[i] = strings.ToLower(id)
	}

	query, args, err := database.In("SELECT id FROM share_records WHERE space = ? AND id IN (?)", space, wanted)
	if err != nil {
		return types.EventMissingResponse{}, err
	}
	stored, err := queryAll(ctx, func(rows *sql.Rows) (string, error) {
		var id string
		return id, rows.Scan(&id)
	}, query, args...)
	if err != nil {
		return types.EventMissingResponse{}, err
	}

	present := make(map[string]struct{}, len(stored))
	for _, id := range stored {
		present[id] = struct{}{}
	}

	missing := []string{}
	for _, id := range ids {
		if _, ok := present[strings.ToLower(id)]; !ok {
			missing = append(missing, id)
		}
	}
	return types.EventMissingResponse{Missing: missing}, nil
}

// measureSpace returns the quota bytes of the given records of a space.
func measureSpace(spaceID string) func(ctx context.Context, tx *sql.Tx, owner string, ids []any) (int64, error) {
	return func(ctx context.Context, tx *sql.Tx, _ string, ids []any) (int64, error) {
		marks := placeholders(len(ids))
		args := append([]any{spaceID}, ids...)
		args = append(args, constants.BucketRowBytes, spaceID)
		args = append(args, ids...)

		var used int64
		err := tx.QueryRowContext(ctx,
			`SELECT (SELECT COALESCE(SUM(OCTET_LENGTH(data)), 0) FROM share_records WHERE space = ? AND id IN (`+marks+`))
				+ (SELECT COUNT(*) * ? FROM share_record_buckets WHERE space = ? AND record_id IN (`+marks+`))`,
			args...,
		).Scan(&used)
		return used, err
	}
}
