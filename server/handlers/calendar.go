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
	"acLife/push"
	"acLife/session"
	"acLife/types"
	"acLife/utils"
)

// upsertEvent pairs a decoded calendar event with its decoded bucket ids.
type upsertEvent struct {
	types.CalendarEvent
	Buckets [][]byte
	IsNew   bool
}

func SaveCalendarEvents(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var changes []struct {
		Type  string               `json:"type"`
		ID    string               `json:"id,omitempty"`
		Event types.EncryptedEvent `json:"event"`
	}
	if err := utils.ParseJSON(r.Body, &changes); err != nil {
		utils.SendBadRequest(w)
		return
	}

	if len(changes) == 0 {
		utils.SendJSON(w, http.StatusOK, types.Reply[any]{
			Success: true,
		})
		return
	}

	ctx := r.Context()
	tx, err := database.DB.BeginTx(ctx, nil) // start transaction
	if err != nil {
		utils.LogError("SaveCalendarEvents", "BeginTx", err)
		utils.SendInternalError(w)
		return
	}
	defer func() { _ = tx.Rollback() }() // rollback if commit never happens

	var deletedIDs []string
	var upserts []upsertEvent

	upsertIndex := make(map[string]int)

	// Process each change
	for _, c := range changes {
		switch c.Type {
		case "deleted":
			deletedIDs = append(deletedIDs, c.ID) // collect IDs to delete

		case "added", "updated":
			decoded, err := base64.StdEncoding.DecodeString(c.Event.Data) // decode event payload
			if err != nil {
				utils.LogError("SaveCalendarEvents", "InvalidBase64", fmt.Errorf("event %s invalid base64: %v", c.Event.ID, err))
				continue
			}

			if len(decoded) > constants.MaxEventLen {
				utils.SendBadRequest(w)
				return
			}

			if len(c.Event.Buckets) == 0 || len(c.Event.Buckets) > constants.MaxEventBuckets {
				utils.SendBadRequest(w)
				return
			}

			buckets := make([][]byte, 0, len(c.Event.Buckets))
			for _, b := range c.Event.Buckets {
				bucketID, err := base64.StdEncoding.DecodeString(b)
				if err != nil || len(bucketID) != constants.BucketIDLen {
					utils.SendBadRequest(w)
					return
				}
				buckets = append(buckets, bucketID)
			}

			ev := upsertEvent{
				CalendarEvent: types.CalendarEvent{
					ID:        c.Event.ID,
					Data:      decoded,
					UpdatedAt: time.UnixMilli(c.Event.UpdatedAt), // convert ms to time.Time
				},
				Buckets: buckets,
				IsNew:   c.Type == "added",
			}

			if idx, ok := upsertIndex[ev.ID]; ok {
				upserts[idx] = ev
			} else {
				upsertIndex[ev.ID] = len(upserts)
				upserts = append(upserts, ev)
			}
		}
	}

	// Batch delete
	if len(deletedIDs) > 0 {
		query := `DELETE FROM calendar_events WHERE owner = ? AND id IN (?` + strings.Repeat(",?", len(deletedIDs)-1) + `)`
		args := make([]any, 0, len(deletedIDs)+1)
		args = append(args, user.UUID)
		for _, id := range deletedIDs {
			args = append(args, id)
		}
		if _, err := tx.ExecContext(ctx, query, args...); err != nil {
			utils.LogError("SaveCalendarEvents", "BatchDelete", err)
			utils.SendInternalError(w)
			return
		}
	}

	// Batch upsert
	if len(upserts) > 0 {
		valueStrings := make([]string, 0, len(upserts))
		valueArgs := make([]any, 0, len(upserts)*4)

		for _, ev := range upserts {
			valueStrings = append(valueStrings, "(?, ?, ?, ?)")
			valueArgs = append(valueArgs, ev.ID, user.UUID, ev.Data, ev.UpdatedAt)
		}

		query := `
		INSERT INTO calendar_events (id, owner, data, updated_at)
		VALUES ` + strings.Join(valueStrings, ",") + `
		ON DUPLICATE KEY UPDATE
			data = IF(owner = VALUES(owner), VALUES(data), data),
			updated_at = IF(owner = VALUES(owner), VALUES(updated_at), updated_at)
		`

		if _, err := tx.ExecContext(ctx, query, valueArgs...); err != nil {
			utils.LogError("SaveCalendarEvents", "BatchUpsert", err)
			utils.SendInternalError(w)
			return
		}

		if err := replaceEventBuckets(ctx, tx, user.UUID, upserts); err != nil {
			utils.LogError("SaveCalendarEvents", "ReplaceBuckets", err)
			utils.SendInternalError(w)
			return
		}
	}

	if err := tx.Commit(); err != nil { // finalize transaction
		utils.LogError("SaveCalendarEvents", "Commit", err)
		utils.SendInternalError(w)
		return
	}

	// Notify other clients via push event
	originClientID := r.URL.Query().Get("c")
	if originClientID != "" && len(originClientID) == 6 {
		go push.SendToUser(context.Background(), user.UUID, push.SyncEvent(originClientID))
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}

// replaceEventBuckets replaces the calendar_event_buckets rows for the given upserts.
func replaceEventBuckets(ctx context.Context, tx *sql.Tx, owner string, upserts []upsertEvent) error {
	ids := make([]any, 0, len(upserts)+1)
	ids = append(ids, owner)
	placeholders := make([]string, 0, len(upserts))
	for _, ev := range upserts {
		if ev.IsNew {
			continue
		}
		ids = append(ids, ev.ID)
		placeholders = append(placeholders, "?")
	}

	if len(placeholders) > 0 {
		if _, err := tx.ExecContext(ctx, `
			DELETE ceb FROM calendar_event_buckets ceb
			JOIN calendar_events ce ON ce.id = ceb.event_id
			WHERE ce.owner = ? AND ceb.event_id IN (`+strings.Join(placeholders, ",")+`)
		`, ids...); err != nil {
			return err
		}
	}

	bucketValues := make([]string, 0)
	bucketArgs := make([]any, 0)
	for _, ev := range upserts {
		for _, bucketID := range ev.Buckets {
			bucketValues = append(bucketValues, "(?, ?)")
			bucketArgs = append(bucketArgs, ev.ID, bucketID)
		}
	}

	if len(bucketValues) == 0 {
		return nil
	}

	_, err := tx.ExecContext(ctx, `
		INSERT IGNORE INTO calendar_event_buckets (event_id, bucket_id) VALUES `+strings.Join(bucketValues, ","),
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

type eventMeta struct {
	ID        string
	UpdatedAt time.Time
	IsLegacy  bool
}

func scanEventMeta(rows *sql.Rows) ([]eventMeta, error) {
	defer func() { _ = rows.Close() }()

	var out []eventMeta
	for rows.Next() {
		var m eventMeta
		var legacy int
		if err := rows.Scan(&m.ID, &m.UpdatedAt, &legacy); err != nil {
			return nil, err
		}
		m.IsLegacy = legacy != 0
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return out, nil
}

func SyncCalendarEvents(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req types.EventSyncRequest
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	cached := req.Events

	// Build map of (eventId: timestamp)
	idToMillis := make(map[string]int64, len(cached))
	for i, c := range cached {
		uuid, err := utils.Base64ToUUID(c.ID)
		if err != nil {
			utils.LogError("SyncCalendarEvents", "InvalidUUID", fmt.Errorf("event %s invalid UUID: %v", c.ID, err))
			continue
		}

		cached[i].ID = uuid
		idToMillis[uuid] = c.Timestamp
	}

	var dbEvents []types.CalendarEvent
	needsBackfill := make([]string, 0)

	if req.Buckets == nil {
		// full sync if no buckets are specified
		rows, err := database.Query(r.Context(), `
			SELECT id, data, updated_at
			FROM calendar_events
			WHERE owner = ?
		`, user.UUID)
		if err != nil {
			utils.LogError("SyncCalendarEvents", "Query", err)
			utils.SendInternalError(w)
			return
		}

		dbEvents, err = scanCalendarEvents(rows)
		if err != nil {
			utils.LogError("SyncCalendarEvents", "Scan", err)
			utils.SendInternalError(w)
			return
		}
	} else {
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
		rangeRows, err := database.Query(r.Context(), `
			SELECT DISTINCT ce.id, ce.data, ce.updated_at
			FROM calendar_events ce
			JOIN calendar_event_buckets ceb ON ceb.event_id = ce.id
			WHERE ce.owner = ? AND ceb.bucket_id IN (`+strings.Join(placeholders, ",")+`)
		`, args...)
		if err != nil {
			utils.LogError("SyncCalendarEvents", "RangeQuery", err)
			utils.SendInternalError(w)
			return
		}

		rangeEvents, err := scanCalendarEvents(rangeRows)
		if err != nil {
			utils.LogError("SyncCalendarEvents", "RangeScan", err)
			utils.SendInternalError(w)
			return
		}
		dbEvents = append(dbEvents, rangeEvents...)

		legacyRows, err := database.Query(r.Context(), `
			SELECT ce.id, ce.data, ce.updated_at
			FROM calendar_events ce
			WHERE ce.owner = ? AND NOT EXISTS (
				SELECT 1 FROM calendar_event_buckets ceb WHERE ceb.event_id = ce.id
			)
			LIMIT ?
		`, user.UUID, constants.MaxBucketBackfillPerSync)
		if err != nil {
			utils.LogError("SyncCalendarEvents", "LegacyQuery", err)
			utils.SendInternalError(w)
			return
		}

		legacyEvents, err := scanCalendarEvents(legacyRows)
		if err != nil {
			utils.LogError("SyncCalendarEvents", "LegacyScan", err)
			utils.SendInternalError(w)
			return
		}
		for _, ev := range legacyEvents {
			needsBackfill = append(needsBackfill, ev.ID)
		}
		dbEvents = append(dbEvents, legacyEvents...)
	}

	seenIDs := make(map[string]struct{})
	updatedEvents := make([]types.EncryptedEvent, 0)
	addedEvents := make([]types.EncryptedEvent, 0)

	// Determine which events are added or updated
	for _, ev := range dbEvents {
		seenIDs[ev.ID] = struct{}{}
		if last, ok := idToMillis[ev.ID]; ok {
			if ev.UpdatedAt.UnixMilli() > last { // updated since last sync
				updatedEvents = append(updatedEvents, types.EncryptedEvent{
					ID:        ev.ID,
					Data:      base64.StdEncoding.EncodeToString(ev.Data),
					UpdatedAt: ev.UpdatedAt.UnixMilli(),
				})
			}
		} else { // new event
			addedEvents = append(addedEvents, types.EncryptedEvent{
				ID:        ev.ID,
				Data:      base64.StdEncoding.EncodeToString(ev.Data),
				UpdatedAt: ev.UpdatedAt.UnixMilli(),
			})
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
			Updated:             updatedEvents,
			Deleted:             deletedIDs,
			Added:               addedEvents,
			NeedsBucketBackfill: needsBackfill,
		},
	})
}
