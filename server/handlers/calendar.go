package handlers

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"time"

	"acLife/database"
	"acLife/push"
	"acLife/session"
	"acLife/types"
	"acLife/utils"
)

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
	var upserts []types.CalendarEvent

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

			upserts = append(upserts, types.CalendarEvent{
				ID:        c.Event.ID,
				Data:      decoded,
				UpdatedAt: time.UnixMilli(c.Event.UpdatedAt), // convert ms to time.Time
			})
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
			data = VALUES(data),
			updated_at = VALUES(updated_at)
		`

		if _, err := tx.ExecContext(ctx, query, valueArgs...); err != nil {
			utils.LogError("SaveCalendarEvents", "BatchUpsert", err)
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
		push.SendToUser(r.Context(), user.UUID, push.SyncEvent(originClientID))
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}

func SyncCalendarEvents(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var cached []types.CachedEvent
	if err := utils.ParseJSON(r.Body, &cached); err != nil {
		utils.SendBadRequest(w)
		return
	}

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

	// Fetch all events for this user from DB
	rows, err := database.Query(r.Context(), `
		SELECT id, data, updated_at
		FROM calendar_events
		WHERE owner = ?
	`, user.UUID)
	if err != nil {
		utils.LogError("SyncCalendarEvents", "QueryAll", err)
		utils.SendInternalError(w)
		return
	}
	defer func() { _ = rows.Close() }()

	var dbEvents []types.CalendarEvent
	for rows.Next() {
		var ev types.CalendarEvent
		if err := rows.Scan(&ev.ID, &ev.Data, &ev.UpdatedAt); err != nil {
			utils.LogError("SyncCalendarEvents", "Scan", err)
			utils.SendInternalError(w)
			return
		}
		dbEvents = append(dbEvents, ev)
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

	// Determine which cached events were deleted
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
