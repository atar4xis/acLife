package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"sort"
	"strings"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/session"
	"acLife/stream"
	"acLife/types"
	"acLife/utils"
)

// upsertEvent pairs a decoded calendar event with its decoded bucket ids.
type upsertEvent struct {
	types.CalendarEvent
	Buckets [][]byte
	Change  stream.Change
}

// EventChange is one entry of a calendar/events/save request body.
type EventChange struct {
	Type  string               `json:"type"`
	ID    string               `json:"id,omitempty"`
	Event types.EncryptedEvent `json:"event"`
}

// errBadEventChanges signals that a batch of changes failed validation (caller should respond 400).
var errBadEventChanges = errors.New("invalid event changes")

func SaveCalendarEvents(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var changes []EventChange
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

	applied, err := applyCalendarChanges(ctx, tx, user.UUID, changes)
	if err != nil {
		if errors.Is(err, errBadEventChanges) {
			utils.SendBadRequest(w)
			return
		}

		utils.LogError("SaveCalendarEvents", "applyCalendarChanges", err)
		utils.SendInternalError(w)
		return
	}

	// commit and publish together so other clients see changes in commit order
	unlock := stream.SerializeCommits(user.UUID)
	err = tx.Commit() // finalize transaction
	if err == nil {
		originClientID := r.URL.Query().Get("c")
		if len(originClientID) != 6 {
			originClientID = ""
		}
		stream.Publish(user.UUID, stream.CalendarChanged(originClientID, applied))
	}
	unlock()
	if err != nil {
		utils.LogError("SaveCalendarEvents", "Commit", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}

// applyCalendarChanges validates and applies a batch of event changes within tx, without committing.
// The last change listed for an event decides its fate. It returns the changes that were applied, one per event.
func applyCalendarChanges(ctx context.Context, tx *sql.Tx, owner string, changes []EventChange) ([]stream.Change, error) {
	deleted := make(map[string]struct{})
	upsertsByID := make(map[string]upsertEvent)

	// Process each change
	for _, c := range changes {
		switch c.Type {
		case "deleted":
			delete(upsertsByID, c.ID)
			deleted[c.ID] = struct{}{}

		case "added", "updated":
			if !utils.IsUUID(c.Event.ID) || c.Event.UpdatedAt < constants.MinEventTimestampMs || c.Event.UpdatedAt > constants.MaxEventTimestampMs {
				return nil, errBadEventChanges
			}

			decoded, err := base64.StdEncoding.DecodeString(c.Event.Data) // decode event payload
			if err != nil || len(decoded) > constants.MaxEventLen {
				return nil, errBadEventChanges
			}

			if len(c.Event.Buckets) == 0 || len(c.Event.Buckets) > constants.MaxEventBuckets {
				return nil, errBadEventChanges
			}

			buckets := make([][]byte, 0, len(c.Event.Buckets))
			for _, b := range c.Event.Buckets {
				bucketID, err := base64.StdEncoding.DecodeString(b)
				if err != nil || len(bucketID) != constants.BucketIDLen {
					return nil, errBadEventChanges
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
				Change:  stream.Change{Type: c.Type, ID: c.Event.ID, Data: c.Event.Data, UpdatedAt: c.Event.UpdatedAt},
			}

			delete(deleted, ev.ID)
			upsertsByID[ev.ID] = ev

		default:
			return nil, errBadEventChanges
		}
	}

	deletedIDs := slices.Sorted(maps.Keys(deleted))
	upserts := make([]upsertEvent, 0, len(upsertsByID))
	for _, id := range slices.Sorted(maps.Keys(upsertsByID)) {
		upserts = append(upserts, upsertsByID[id])
	}

	// Batch delete
	if len(deletedIDs) > 0 {
		query := `DELETE FROM calendar_events WHERE owner = ? AND id IN (?` + strings.Repeat(",?", len(deletedIDs)-1) + `)`
		args := make([]any, 0, len(deletedIDs)+1)
		args = append(args, owner)
		for _, id := range deletedIDs {
			args = append(args, id)
		}
		if _, err := tx.ExecContext(ctx, query, args...); err != nil {
			return nil, err
		}
	}

	// Batch upsert
	if len(upserts) > 0 {
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
			return nil, err
		}

		if err := replaceEventBuckets(ctx, tx, owner, upserts); err != nil {
			return nil, err
		}
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

// bucketHash hashes the "uuid:updatedAtMillis" lines of a bucket, line order does not matter.
func bucketHash(lines []string) string {
	sorted := append([]string(nil), lines...)
	sort.Strings(sorted)
	sum := sha256.Sum256([]byte(strings.Join(sorted, "\n")))
	return base64.StdEncoding.EncodeToString(sum[:])
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
		lines[key] = append(lines[key], fmt.Sprintf("%s:%d", strings.ToLower(id), updatedAt.UnixMilli()))
	}
	if err := rows.Err(); err != nil {
		utils.LogError("syncHashes", "Rows", err)
		utils.SendInternalError(w)
		return
	}

	// legacy events only reach the client through the full diff, which also backfills them
	var hasLegacy bool
	if err := database.QueryRow(r.Context(), `
		SELECT EXISTS (
			SELECT 1 FROM calendar_events ce
			WHERE ce.owner = ? AND NOT EXISTS (
				SELECT 1 FROM calendar_event_buckets ceb WHERE ceb.event_id = ce.id
			)
		)
	`, owner).Scan(&hasLegacy); err != nil {
		utils.LogError("syncHashes", "LegacyQuery", err)
		utils.SendInternalError(w)
		return
	}

	mismatched := make([]string, 0, len(hashes))
	for b, want := range hashes {
		if hasLegacy || bucketHash(lines[b]) != want {
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
