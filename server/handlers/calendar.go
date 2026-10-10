package handlers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
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

// EventChange is one entry of a calendar/events/save request body.
type EventChange = types.RecordChange[types.EncryptedEvent]

// upsertEvent pairs a decoded calendar event with its decoded bucket ids.
type upsertEvent struct {
	types.CalendarEvent
	Buckets [][]byte
	Change  stream.Change
}

func SaveCalendarEvents(w http.ResponseWriter, r *http.Request) {
	saveChanges(w, r, "SaveCalendarEvents", applyCalendarChanges, func(originClientID string, applied []stream.Change) stream.Message {
		return stream.Changed("calendar", originClientID, applied)
	})
}

// applyCalendarChanges validates and applies a batch of event changes within tx, without committing.
func applyCalendarChanges(ctx context.Context, tx *sql.Tx, owner string, changes []EventChange) ([]stream.Change, error) {
	collected, err := collectChanges(changes, identity, func(c EventChange, id string) (upsertEvent, error) {
		decoded, err := base64.StdEncoding.DecodeString(c.Record.Data) // decode event payload
		if err != nil || len(decoded) > constants.MaxEventLen {
			return upsertEvent{}, errBadChanges
		}

		if len(c.Record.Buckets) == 0 || len(c.Record.Buckets) > constants.MaxEventBuckets {
			return upsertEvent{}, errBadChanges
		}

		buckets := make([][]byte, 0, len(c.Record.Buckets))
		for _, b := range c.Record.Buckets {
			bucketID, err := base64.StdEncoding.DecodeString(b)
			if err != nil || len(bucketID) != constants.BucketIDLen {
				return upsertEvent{}, errBadChanges
			}
			buckets = append(buckets, bucketID)
		}

		return upsertEvent{
			CalendarEvent: types.CalendarEvent{
				ID:        id,
				Data:      decoded,
				UpdatedAt: time.UnixMilli(c.Record.UpdatedAt), // convert ms to time.Time
			},
			Buckets: buckets,
			Change:  stream.Change{Type: c.Type, ID: id, Data: c.Record.Data, UpdatedAt: c.Record.UpdatedAt},
		}, nil
	})
	if err != nil {
		return nil, err
	}
	deletedIDs, upserts := collected.deleted, collected.upserts

	err = withQuota(ctx, tx, owner, collected.touched, measureEvents, func() error {
		// Batch delete
		if len(deletedIDs) > 0 {
			query := `DELETE FROM calendar_events WHERE owner = ? AND id IN (?` + strings.Repeat(",?", len(deletedIDs)-1) + `)`
			args := make([]any, 0, len(deletedIDs)+1)
			args = append(args, owner)
			for _, id := range deletedIDs {
				args = append(args, id)
			}
			if _, err := tx.ExecContext(ctx, query, args...); err != nil {
				return err
			}
		}

		// Batch upsert
		if len(upserts) == 0 {
			return nil
		}

		valueStrings := make([]string, 0, len(upserts))
		valueArgs := make([]any, 0, len(upserts)*4)

		for _, ev := range upserts {
			valueStrings = append(valueStrings, "(?, ?, ?, ?)")
			valueArgs = append(valueArgs, ev.ID, owner, ev.Data, ev.UpdatedAt)
		}

		query := `
		INSERT INTO calendar_events (id, owner, data, updated_at)
		VALUES ` + strings.Join(valueStrings, ",") + `
		ON DUPLICATE KEY UPDATE
			data = IF(owner = VALUES(owner), VALUES(data), data),
			updated_at = IF(owner = VALUES(owner), VALUES(updated_at), updated_at)
		`

		if _, err := tx.ExecContext(ctx, query, valueArgs...); err != nil {
			return err
		}

		return replaceEventBuckets(ctx, tx, owner, upserts)
	})
	if err != nil {
		return nil, err
	}

	applied := make([]stream.Change, 0, len(deletedIDs)+len(upserts))
	for _, id := range deletedIDs {
		applied = append(applied, stream.Change{Type: "deleted", ID: id})
	}
	for _, ev := range upserts {
		applied = append(applied, ev.Change)
	}

	return applied, nil
}

// replaceEventBuckets replaces the calendar_event_buckets rows for the given upserts.
func replaceEventBuckets(ctx context.Context, tx *sql.Tx, owner string, upserts []upsertEvent) error {
	ids := make([]any, 0, len(upserts)+1)
	ids = append(ids, owner)
	placeholders := make([]string, 0, len(upserts))
	for _, ev := range upserts {
		ids = append(ids, ev.ID)
		placeholders = append(placeholders, "?")
	}

	if _, err := tx.ExecContext(ctx, `
		DELETE ceb FROM calendar_event_buckets ceb
		JOIN calendar_events ce ON ce.id = ceb.event_id
		WHERE ce.owner = ? AND ceb.event_id IN (`+strings.Join(placeholders, ",")+`)
	`, ids...); err != nil {
		return err
	}

	owned, err := ownedEventIDs(ctx, tx, owner, upserts)
	if err != nil {
		return err
	}

	bucketValues := make([]string, 0)
	bucketArgs := make([]any, 0)
	for _, ev := range upserts {
		if _, ok := owned[strings.ToLower(ev.ID)]; !ok {
			continue
		}
		for _, bucketID := range ev.Buckets {
			bucketValues = append(bucketValues, "(?, ?)")
			bucketArgs = append(bucketArgs, ev.ID, bucketID)
		}
	}

	if len(bucketValues) == 0 {
		return nil
	}

	_, err = tx.ExecContext(ctx, `
		INSERT IGNORE INTO calendar_event_buckets (event_id, bucket_id) VALUES `+strings.Join(bucketValues, ","),
		bucketArgs...,
	)
	return err
}

// ownedEventIDs returns the lowercased ids of the given upserts that belong to owner.
func ownedEventIDs(ctx context.Context, tx *sql.Tx, owner string, upserts []upsertEvent) (map[string]struct{}, error) {
	args := make([]any, 0, len(upserts)+1)
	args = append(args, owner)
	for _, ev := range upserts {
		args = append(args, ev.ID)
	}

	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM calendar_events WHERE owner = ? AND id IN (?`+strings.Repeat(",?", len(upserts)-1)+`)`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	owned := make(map[string]struct{}, len(upserts))
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		owned[strings.ToLower(id)] = struct{}{}
	}
	return owned, rows.Err()
}

// scanCalendarEvents reads all rows of (id, data, updated_at) and closes rows.
func scanCalendarEvents(rows *sql.Rows) ([]types.CalendarEvent, error) {
	defer func() { _ = rows.Close() }()

	var events []types.CalendarEvent
	for rows.Next() {
		var ev types.CalendarEvent
		if err := rows.Scan(&ev.ID, &ev.Data, &ev.UpdatedAt); err != nil {
			return nil, err
		}
		events = append(events, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return events, nil
}

// syncHashes replies with the requested buckets whose server-side hash differs from the client's.
func syncHashes(w http.ResponseWriter, r *http.Request, owner string, hashes map[string]string) {
	if len(hashes) == 0 || len(hashes) > constants.MaxSyncBuckets {
		utils.SendBadRequest(w)
		return
	}

	args := make([]any, 0, len(hashes)+1)
	args = append(args, owner)
	placeholders := make([]string, 0, len(hashes))
	keys := make(map[string]string, len(hashes))
	for b := range hashes {
		bucketID, err := base64.StdEncoding.DecodeString(b)
		if err != nil || len(bucketID) != constants.BucketIDLen {
			utils.SendBadRequest(w)
			return
		}
		args = append(args, bucketID)
		placeholders = append(placeholders, "?")
		keys[string(bucketID)] = b
	}

	rows, err := database.Query(r.Context(), `
		SELECT ceb.bucket_id, ce.id, ce.updated_at
		FROM calendar_events ce
		JOIN calendar_event_buckets ceb ON ceb.event_id = ce.id
		WHERE ce.owner = ? AND ceb.bucket_id IN (`+strings.Join(placeholders, ",")+`)
	`, args...)
	if err != nil {
		utils.LogError("syncHashes", "Query", err)
		utils.SendInternalError(w)
		return
	}
	defer func() { _ = rows.Close() }()

	lines := make(map[string][]string, len(hashes))
	for rows.Next() {
		var bucketID []byte
		var id string
		var updatedAt time.Time
		if err := rows.Scan(&bucketID, &id, &updatedAt); err != nil {
			utils.LogError("syncHashes", "Scan", err)
			utils.SendInternalError(w)
			return
		}
		key := keys[string(bucketID)]
		lines[key] = append(lines[key], hashLine(id, updatedAt))
	}
	if err := rows.Err(); err != nil {
		utils.LogError("syncHashes", "Rows", err)
		utils.SendInternalError(w)
		return
	}

	mismatched := make([]string, 0, len(hashes))
	for b, want := range hashes {
		if bucketHash(lines[b]) != want {
			mismatched = append(mismatched, b)
		}
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[types.EventHashResponse]{
		Success: true,
		Data:    types.EventHashResponse{Mismatched: mismatched},
	})
}

func SyncCalendarEvents(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req types.EventSyncRequest
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	if req.Hashes != nil {
		syncHashes(w, r, user.UUID, req.Hashes)
		return
	}

	cached := req.Records
	if len(cached) > constants.MaxRequestRecords {
		utils.SendBadRequest(w)
		return
	}

	// Build map of (eventId: timestamp)
	idToMillis := make(map[string]int64, len(cached))
	invalidIDs := 0
	for i, c := range cached {
		uuid, err := utils.Base64ToUUID(c.ID)
		if err != nil {
			invalidIDs++
			continue
		}

		cached[i].ID = uuid
		idToMillis[uuid] = c.Timestamp
	}
	if invalidIDs > 0 {
		utils.LogError("SyncCalendarEvents", "InvalidUUID", fmt.Errorf("%d invalid event ids", invalidIDs))
	}

	if len(req.Buckets) == 0 || len(req.Buckets) > constants.MaxSyncBuckets {
		utils.SendBadRequest(w)
		return
	}

	args := make([]any, 0, len(req.Buckets)+1)
	args = append(args, user.UUID)
	placeholders := make([]string, 0, len(req.Buckets))
	for _, b := range req.Buckets {
		bucketID, err := base64.StdEncoding.DecodeString(b)
		if err != nil || len(bucketID) != constants.BucketIDLen {
			utils.SendBadRequest(w)
			return
		}
		args = append(args, bucketID)
		placeholders = append(placeholders, "?")
	}

	// events whose buckets fall in the requested range
	rows, err := database.Query(r.Context(), `
		SELECT ce.id, ce.data, ce.updated_at
		FROM calendar_events ce
		WHERE ce.owner = ? AND EXISTS (
			SELECT 1 FROM calendar_event_buckets ceb
			WHERE ceb.event_id = ce.id AND ceb.bucket_id IN (`+strings.Join(placeholders, ",")+`)
		)
	`, args...)
	if err != nil {
		utils.LogError("SyncCalendarEvents", "RangeQuery", err)
		utils.SendInternalError(w)
		return
	}

	dbEvents, err := scanCalendarEvents(rows)
	if err != nil {
		utils.LogError("SyncCalendarEvents", "RangeScan", err)
		utils.SendInternalError(w)
		return
	}

	seenIDs := make(map[string]struct{})
	updatedEvents := make([]types.EncryptedEvent, 0)
	addedEvents := make([]types.EncryptedEvent, 0)

	// Determine which events are added or updated
	for _, ev := range dbEvents {
		seenIDs[ev.ID] = struct{}{}
		if last, ok := idToMillis[ev.ID]; ok {
			if ev.UpdatedAt.UnixMilli() > last { // updated since last sync
				updatedEvents = append(updatedEvents, types.EncryptedEvent{EncryptedRecord: types.EncryptedRecord{
					ID:        ev.ID,
					Data:      base64.StdEncoding.EncodeToString(ev.Data),
					UpdatedAt: ev.UpdatedAt.UnixMilli(),
				}})
			}
		} else { // new event
			addedEvents = append(addedEvents, types.EncryptedEvent{EncryptedRecord: types.EncryptedRecord{
				ID:        ev.ID,
				Data:      base64.StdEncoding.EncodeToString(ev.Data),
				UpdatedAt: ev.UpdatedAt.UnixMilli(),
			}})
		}
	}

	deletedIDs := make([]string, 0, len(cached))
	for _, c := range cached {
		if _, ok := seenIDs[c.ID]; !ok {
			deletedIDs = append(deletedIDs, c.ID)
		}
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[types.EventSyncResponse]{
		Success: true,
		Data: types.EventSyncResponse{
			Updated: updatedEvents,
			Deleted: deletedIDs,
			Added:   addedEvents,
		},
	})
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
