package handlers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/session"
	"acLife/types"
	"acLife/utils"
)

// storedBytesSQL is what one calendar_events row (alias ce) counts toward the quota: its data plus its bucket rows, it takes constants.BucketRowBytes as its argument.
const storedBytesSQL = `OCTET_LENGTH(ce.data) + ? * (SELECT COUNT(*) FROM calendar_event_buckets ceb WHERE ceb.event_id = ce.id)`

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
		"SELECT event_bytes, max_bytes FROM user_storage WHERE owner = ?",
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
func lockStorage(ctx context.Context, tx *sql.Tx, owner string) (used, limit int64, err error) {
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO user_storage (owner) VALUES (?) ON DUPLICATE KEY UPDATE owner = owner",
		owner,
	); err != nil {
		return 0, 0, err
	}

	var override sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		"SELECT event_bytes, max_bytes FROM user_storage WHERE owner = ? FOR UPDATE",
		owner,
	).Scan(&used, &override); err != nil {
		return 0, 0, err
	}

	limit = storageLimit(override)
	if used < 0 {
		used, err = countStorage(ctx, tx, owner)
	}
	return used, limit, err
}

func countStorage(ctx context.Context, q rowQuerier, owner string) (int64, error) {
	var used int64
	err := q.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(`+storedBytesSQL+`), 0) FROM calendar_events ce WHERE ce.owner = ?`,
		constants.BucketRowBytes, owner,
	).Scan(&used)
	return used, err
}

// measureEvents returns the quota bytes of the owner's events among ids.
func measureEvents(ctx context.Context, tx *sql.Tx, owner string, ids []any) (int64, error) {
	var used int64
	err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(`+storedBytesSQL+`), 0) FROM calendar_events ce WHERE ce.owner = ? AND ce.id IN (?`+strings.Repeat(",?", len(ids)-1)+`)`,
		append([]any{constants.BucketRowBytes, owner}, ids...)...,
	).Scan(&used)
	return used, err
}

func saveStorage(ctx context.Context, tx *sql.Tx, owner string, used int64) error {
	_, err := tx.ExecContext(ctx, "UPDATE user_storage SET event_bytes = ? WHERE owner = ?", used, owner)
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
		"SELECT owner, event_bytes FROM user_storage WHERE owner > ? ORDER BY owner LIMIT ?",
		after, constants.StorageReconcileBatch,
	)
	if err != nil {
		return nil, "", err
	}

	counted := map[string]int64{}
	var owners []any
	for rows.Next() {
		var owner string
		var used int64
		if err := rows.Scan(&owner, &used); err != nil {
			_ = rows.Close()
			return nil, "", err
		}
		counted[owner] = used
		owners = append(owners, owner)
		last = owner
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil || len(owners) == 0 {
		return nil, "", err
	}

	rows, err = database.Query(ctx,
		`SELECT ce.owner, SUM(`+storedBytesSQL+`) FROM calendar_events ce WHERE ce.owner IN (?`+strings.Repeat(",?", len(owners)-1)+`) GROUP BY ce.owner`,
		append([]any{constants.BucketRowBytes}, owners...)...,
	)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = rows.Close() }()

	actual := map[string]int64{}
	for rows.Next() {
		var owner string
		var used int64
		if err := rows.Scan(&owner, &used); err != nil {
			return nil, "", err
		}
		actual[owner] = used
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}

	for _, owner := range owners {
		if actual[owner.(string)] != counted[owner.(string)] {
			suspects = append(suspects, owner.(string))
		}
	}
	return suspects, last, nil
}

// fixStorage corrects one owner's counter under their lock, it reports whether it was wrong.
func fixStorage(ctx context.Context, owner string) (bool, error) {
	var counted, actual int64
	fixed := false
	err := database.RunTx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx,
			"SELECT event_bytes FROM user_storage WHERE owner = ? FOR UPDATE",
			owner,
		).Scan(&counted); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}

		var err error
		if actual, err = countStorage(ctx, tx, owner); err != nil {
			return err
		}
		fixed = actual != counted
		if !fixed {
			return nil
		}

		if err := saveStorage(ctx, tx, owner, actual); err != nil {
			return err
		}
		return tx.Commit()
	})
	if err != nil || !fixed {
		return false, err
	}

	utils.LogInfo("reconcileStorage: corrected the counter of owner %s from %d to %d bytes", owner, counted, actual)
	return true, nil
}
