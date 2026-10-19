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
	collected, err := collectChanges(changes, strings.ToLower, func(c EventChange, id string) (upsertEvent, error) {
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

	err = withQuota(ctx, tx, owner, personalBytes, collected.touched, measureEvents, func() error {
		// Batch delete
		if len(deletedIDs) > 0 {
			query := `DELETE FROM calendar_events WHERE owner = ? AND id IN (` + placeholders(len(deletedIDs)) + `)`
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
	for _, ev := range upserts {
		ids = append(ids, ev.ID)
	}

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM calendar_event_buckets WHERE owner = ? AND event_id IN (`+placeholders(len(upserts))+`)`,
		ids...,
	); err != nil {
		return err
	}

	bucketValues := make([]string, 0)
	bucketArgs := make([]any, 0)
	for _, ev := range upserts {
		for _, bucketID := range ev.Buckets {
			bucketValues = append(bucketValues, "(?, ?, ?)")
			bucketArgs = append(bucketArgs, owner, ev.ID, bucketID)
		}
	}

	if len(bucketValues) == 0 {
		return nil
	}

	_, err := tx.ExecContext(ctx, `
		INSERT IGNORE INTO calendar_event_buckets (owner, event_id, bucket_id) VALUES `+strings.Join(bucketValues, ","),
		bucketArgs...,
	)
	return err
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

const eventHashQuery = `
		SELECT ceb.bucket_id, ce.id, ce.updated_at
		FROM calendar_events ce
		JOIN calendar_event_buckets ceb ON ceb.owner = ce.owner AND ceb.event_id = ce.id
		WHERE ce.owner = ? AND ceb.bucket_id IN (%s)`

const eventRangeQuery = `
		SELECT ce.id, ce.data, ce.updated_at
		FROM calendar_events ce
		WHERE ce.owner = ? AND EXISTS (
			SELECT 1 FROM calendar_event_buckets ceb
			WHERE ceb.owner = ce.owner AND ceb.event_id = ce.id AND ceb.bucket_id IN (%s)
		)`

func mismatchedEventBuckets(ctx context.Context, query, key string, hashes map[string]string) (types.EventHashResponse, error) {
	if len(hashes) == 0 || len(hashes) > constants.MaxSyncBuckets {
		return types.EventHashResponse{}, errBadSync
	}

	args := make([]any, 0, len(hashes)+1)
	args = append(args, key)
	keys := make(map[string]string, len(hashes))
	for b := range hashes {
		bucketID, err := base64.StdEncoding.DecodeString(b)
		if err != nil || len(bucketID) != constants.BucketIDLen {
			return types.EventHashResponse{}, errBadSync
		}
		args = append(args, bucketID)
		keys[string(bucketID)] = b
	}

	rows, err := database.Query(ctx, fmt.Sprintf(query, placeholders(len(hashes))), args...)
	if err != nil {
		return types.EventHashResponse{}, err
	}
	defer func() { _ = rows.Close() }()

	lines := make(map[string][]string, len(hashes))
	for rows.Next() {
		var bucketID []byte
		var id string
		var updatedAt time.Time
		if err := rows.Scan(&bucketID, &id, &updatedAt); err != nil {
			return types.EventHashResponse{}, err
		}
		key := keys[string(bucketID)]
		lines[key] = append(lines[key], hashLine(id, updatedAt))
	}
	if err := rows.Err(); err != nil {
		return types.EventHashResponse{}, err
	}

	mismatched := make([]string, 0, len(hashes))
	for b, want := range hashes {
		if bucketHash(lines[b]) != want {
			mismatched = append(mismatched, b)
		}
	}

	return types.EventHashResponse{Mismatched: mismatched}, nil
}

func SyncCalendarEvents(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req types.EventSyncRequest
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	records := 0
	for _, part := range req.Parts {
		records += len(part.Records) + len(part.Exists)
	}
	if records > constants.MaxRequestRecords {
		utils.SendBadRequest(w)
		return
	}

	syncParts(w, r, "SyncCalendarEvents", kindCalendar, req.Parts,
		func(part types.EventSyncPart) string { return part.Space },
		func(ctx context.Context, space string, part types.EventSyncPart) (any, error) {
			hashQuery, rangeQuery, key := eventHashQuery, eventRangeQuery, user.UUID
			if space != "" {
				hashQuery, rangeQuery, key = sharedHashQuery, sharedRangeQuery, space
			}

			if part.Hashes != nil {
				return mismatchedEventBuckets(ctx, hashQuery, key, part.Hashes)
			}

			if part.Exists != nil {
				return missingRecords(ctx, space, part.Exists)
			}

			cached := make([]types.CachedRecord, len(part.Records))
			for i, c := range part.Records {
				if !utils.IsUUID(c.ID) {
					return nil, errBadSync
				}
				cached[i] = types.CachedRecord{ID: strings.ToLower(c.ID), Timestamp: c.Timestamp}
			}

			return diffEventBuckets(ctx, rangeQuery, key, part.Buckets, cached)
		},
	)
}

func diffEventBuckets(ctx context.Context, query, key string, buckets []string, cached []types.CachedRecord) (types.EventSyncResponse, error) {
	if len(buckets) == 0 || len(buckets) > constants.MaxSyncBuckets {
		return types.EventSyncResponse{}, errBadSync
	}

	args := make([]any, 0, len(buckets)+1)
	args = append(args, key)
	for _, b := range buckets {
		bucketID, err := base64.StdEncoding.DecodeString(b)
		if err != nil || len(bucketID) != constants.BucketIDLen {
			return types.EventSyncResponse{}, errBadSync
		}
		args = append(args, bucketID)
	}

	rows, err := database.Query(ctx, fmt.Sprintf(query, placeholders(len(buckets))), args...)
	if err != nil {
		return types.EventSyncResponse{}, err
	}

	dbEvents, err := scanCalendarEvents(rows)
	if err != nil {
		return types.EventSyncResponse{}, err
	}

	return diffEvents(dbEvents, cached), nil
}

func diffEvents(dbEvents []types.CalendarEvent, cached []types.CachedRecord) types.EventSyncResponse {
	// Build map of (eventId: timestamp)
	idToMillis := make(map[string]int64, len(cached))
	for _, c := range cached {
		idToMillis[c.ID] = c.Timestamp
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

	return types.EventSyncResponse{Updated: updatedEvents, Deleted: deletedIDs, Added: addedEvents}
}

// measureEvents returns the quota bytes of the owner's events among ids.
func measureEvents(ctx context.Context, tx *sql.Tx, owner string, ids []any) (int64, error) {
	var used int64
	err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(`+storedBytesSQL+`), 0) FROM calendar_events ce WHERE ce.owner = ? AND ce.id IN (`+placeholders(len(ids))+`)`,
		append([]any{constants.BucketRowBytes, owner}, ids...)...,
	).Scan(&used)
	return used, err
}
