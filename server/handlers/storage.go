package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"slices"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/session"
	"acLife/types"
	"acLife/utils"
)

// storedBytesSQL is what one calendar_events row (alias ce) counts toward the quota: its data plus its bucket rows, it takes constants.BucketRowBytes as its argument.
const storedBytesSQL = `OCTET_LENGTH(ce.data) + ? * (SELECT COUNT(*) FROM calendar_event_buckets ceb WHERE ceb.owner = ce.owner AND ceb.event_id = ce.id)`

// sharedStoredBytesSQL is what the records of all the owner's spaces count toward their shared quota, it takes the owner, constants.BucketRowBytes and the owner again.
const sharedStoredBytesSQL = `(SELECT COALESCE(SUM(OCTET_LENGTH(sr.data)), 0) FROM share_records sr JOIN share_spaces sp ON sp.id = sr.space WHERE sp.owner = ?)
	+ (SELECT COUNT(*) * ? FROM share_record_buckets srb JOIN share_spaces sp ON sp.id = srb.space WHERE sp.owner = ?)`

// quotaCounter picks which user_storage column a quota check reads and how to recount it.
type quotaCounter struct {
	column string
	count  func(ctx context.Context, q rowQuerier, owner string) (int64, error)
}

var (
	personalBytes = quotaCounter{"used_bytes", countStorage}
	sharedBytes   = quotaCounter{"shared_bytes", countSharedStorage}
)

type storageBytes struct {
	personal, shared int64
}

type rowQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// storageLimit is the user's max_bytes override, or MaxUserBytes when it is NULL.
func storageLimit(override sql.NullInt64) int64 {
	if override.Valid {
		return override.Int64
	}
	return constants.MaxUserBytes
}

// GetQuota reports the bytes the user stores and their limit.
func GetQuota(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	used := int64(-1)
	var override sql.NullInt64
	if err := database.QueryRow(r.Context(),
		"SELECT used_bytes, max_bytes FROM user_storage WHERE owner = ?",
		user.UUID,
	).Scan(&used, &override); err != nil && !errors.Is(err, sql.ErrNoRows) {
		utils.LogError("GetQuota", "QueryRow(user_storage)", err)
		utils.SendInternalError(w)
		return
	}

	if used < 0 {
		var err error
		if used, err = countStorage(r.Context(), database.DB, user.UUID); err != nil {
			utils.LogError("GetQuota", "countStorage", err)
			utils.SendInternalError(w)
			return
		}
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[types.Quota]{
		Success: true,
		Data:    types.Quota{Used: used, Limit: storageLimit(override)},
	})
}

// lockStorage takes the owner's user_storage lock, which serializes that owner's saves until tx ends.
func lockStorage(ctx context.Context, tx *sql.Tx, owner string, c quotaCounter) (used, limit int64, err error) {
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO user_storage (owner) VALUES (?) ON DUPLICATE KEY UPDATE owner = owner",
		owner,
	); err != nil {
		return 0, 0, err
	}

	var override sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		"SELECT "+c.column+", max_bytes FROM user_storage WHERE owner = ? FOR UPDATE",
		owner,
	).Scan(&used, &override); err != nil {
		return 0, 0, err
	}

	limit = storageLimit(override)
	if used < 0 {
		used, err = c.count(ctx, tx, owner)
	}
	return used, limit, err
}

func countStorage(ctx context.Context, q rowQuerier, owner string) (int64, error) {
	var used int64
	err := q.QueryRowContext(ctx,
		`SELECT (SELECT COALESCE(SUM(`+storedBytesSQL+`), 0) FROM calendar_events ce WHERE ce.owner = ?)
			+ (SELECT COALESCE(SUM(OCTET_LENGTH(data)), 0) FROM journal_items WHERE owner = ?)`,
		constants.BucketRowBytes, owner, owner,
	).Scan(&used)
	return used, err
}

func countSharedStorage(ctx context.Context, q rowQuerier, owner string) (int64, error) {
	var used int64
	err := q.QueryRowContext(ctx, `SELECT `+sharedStoredBytesSQL, owner, constants.BucketRowBytes, owner).Scan(&used)
	return used, err
}

func withQuota(ctx context.Context, tx *sql.Tx, owner string, c quotaCounter, touched []any, measure func(ctx context.Context, tx *sql.Tx, owner string, ids []any) (int64, error), write func() error) error {
	used, limit, err := lockStorage(ctx, tx, owner, c)
	if err != nil {
		return err
	}

	before, err := measure(ctx, tx, owner, touched)
	if err != nil {
		return err
	}

	if err := write(); err != nil {
		return err
	}

	after, err := measure(ctx, tx, owner, touched)
	if err != nil {
		return err
	}
	used += after - before

	if used > limit && after > before {
		return errStorageLimit
	}
	return saveStorage(ctx, tx, owner, c, used)
}

func saveStorage(ctx context.Context, tx *sql.Tx, owner string, c quotaCounter, used int64) error {
	_, err := tx.ExecContext(ctx, "UPDATE user_storage SET "+c.column+" = ? WHERE owner = ?", used, owner)
	return err
}

func reconcileStorageLoop() {
	timer := time.NewTimer(constants.StorageReconcileDelay)
	defer timer.Stop()

	for range timer.C {
		reconcileStorage(context.Background())
		timer.Reset(constants.StorageReconcileEvery)
	}
}

// reconcileStorage compares every user's counters with their events and corrects the ones that differ, it returns how many it corrected.
func reconcileStorage(ctx context.Context) int {
	fixed := 0
	last := ""
	for {
		suspects, next, err := storageSuspects(ctx, last)
		if err != nil {
			utils.LogError("reconcileStorage", "storageSuspects", err)
			return fixed
		}
		if next == "" {
			return fixed
		}
		last = next

		for _, owner := range suspects {
			ok, err := fixStorage(ctx, owner)
			if err != nil {
				utils.LogError("reconcileStorage", "fixStorage", err)
				continue
			}
			if ok {
				fixed++
			}
		}
	}
}

// storageSuspects returns the owners of the next batch after the given one whose counter looks wrong, and the last owner of the batch.
func storageSuspects(ctx context.Context, after string) (suspects []string, last string, err error) {
	rows, err := database.Query(ctx,
		"SELECT owner, used_bytes, shared_bytes FROM user_storage WHERE owner > ? ORDER BY owner LIMIT ?",
		after, constants.StorageReconcileBatch,
	)
	if err != nil {
		return nil, "", err
	}

	recorded := map[string]storageBytes{}
	var owners []any
	for rows.Next() {
		var owner string
		var used, shared int64
		if err := rows.Scan(&owner, &used, &shared); err != nil {
			_ = rows.Close()
			return nil, "", err
		}
		recorded[owner] = storageBytes{used, shared}
		owners = append(owners, owner)
		last = owner
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil || len(owners) == 0 {
		return nil, "", err
	}

	inList := placeholders(len(owners))
	rows, err = database.Query(ctx,
		`SELECT owner, SUM(bytes) FROM (
			SELECT ce.owner AS owner, `+storedBytesSQL+` AS bytes FROM calendar_events ce WHERE ce.owner IN (`+inList+`)
			UNION ALL
			SELECT owner, OCTET_LENGTH(data) FROM journal_items WHERE owner IN (`+inList+`)
		) stored GROUP BY owner`,
		append(append([]any{constants.BucketRowBytes}, owners...), owners...)...,
	)
	if err != nil {
		return nil, "", err
	}

	actual := map[string]storageBytes{}
	if err := collectOwnerBytes(rows, actual, func(b *storageBytes, n int64) { b.personal = n }); err != nil {
		return nil, "", err
	}

	sharedArgs := slices.Concat(owners, []any{constants.BucketRowBytes}, owners)
	sharedRows, err := database.Query(ctx,
		`SELECT owner, SUM(bytes) FROM (
			SELECT sp.owner AS owner, OCTET_LENGTH(sr.data) AS bytes FROM share_records sr JOIN share_spaces sp ON sp.id = sr.space WHERE sp.owner IN (`+inList+`)
			UNION ALL
			SELECT sp.owner, ? FROM share_record_buckets srb JOIN share_spaces sp ON sp.id = srb.space WHERE sp.owner IN (`+inList+`)
		) stored GROUP BY owner`,
		sharedArgs...,
	)
	if err != nil {
		return nil, "", err
	}

	if err := collectOwnerBytes(sharedRows, actual, func(b *storageBytes, n int64) { b.shared = n }); err != nil {
		return nil, "", err
	}

	for _, owner := range owners {
		if actual[owner.(string)] != recorded[owner.(string)] {
			suspects = append(suspects, owner.(string))
		}
	}
	return suspects, last, nil
}

// collectOwnerBytes reads (owner, bytes) rows into the map with set and closes rows.
func collectOwnerBytes(rows *sql.Rows, into map[string]storageBytes, set func(*storageBytes, int64)) error {
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var owner string
		var used int64
		if err := rows.Scan(&owner, &used); err != nil {
			return err
		}
		bytes := into[owner]
		set(&bytes, used)
		into[owner] = bytes
	}
	return rows.Err()
}

// fixStorage corrects one owner's counters under their lock, it reports whether either was wrong.
func fixStorage(ctx context.Context, owner string) (bool, error) {
	var recorded, actual storageBytes
	fixed := false
	err := database.RunTx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx,
			"SELECT used_bytes, shared_bytes FROM user_storage WHERE owner = ? FOR UPDATE",
			owner,
		).Scan(&recorded.personal, &recorded.shared); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}

		var err error
		if actual.personal, err = personalBytes.count(ctx, tx, owner); err != nil {
			return err
		}
		if actual.shared, err = sharedBytes.count(ctx, tx, owner); err != nil {
			return err
		}
		fixed = actual != recorded
		if !fixed {
			return nil
		}

		if err := saveStorage(ctx, tx, owner, personalBytes, actual.personal); err != nil {
			return err
		}
		if err := saveStorage(ctx, tx, owner, sharedBytes, actual.shared); err != nil {
			return err
		}
		return tx.Commit()
	})
	if err != nil || !fixed {
		return false, err
	}

	utils.LogInfo("reconcileStorage: corrected the counters of owner %s from %d/%d to %d/%d bytes (personal/shared)", owner, recorded.personal, recorded.shared, actual.personal, actual.shared)
	return true, nil
}
