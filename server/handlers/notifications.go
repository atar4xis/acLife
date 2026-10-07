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
	"acLife/push"
	"acLife/session"
	"acLife/types"
	"acLife/utils"
)

type notificationTime struct {
	At     int64 `json:"at"`
	Device bool  `json:"device"`
}

type notificationEvent struct {
	ID    string             `json:"id"`
	Times []notificationTime `json:"times"`
}

// SyncNotifications replaces the scheduled notifications of the given events.
func SyncNotifications(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req struct {
		Endpoint string              `json:"endpoint"`
		Events   []notificationEvent `json:"events"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil || len(req.Events) == 0 || len(req.Events) > constants.MaxNotificationEvents {
		utils.SendBadRequest(w)
		return
	}

	now := time.Now()
	earliest := now.Add(-constants.NotificationGrace).UnixMilli()
	latest := now.Add(constants.NotificationHorizon).UnixMilli()
	total := 0
	ids := make([]any, 0, len(req.Events))
	for i := range req.Events {
		ev := &req.Events[i]
		ev.ID = strings.ToLower(ev.ID)
		if !utils.IsUUID(ev.ID) {
			utils.SendBadRequest(w)
			return
		}
		ids = append(ids, ev.ID)

		total += len(ev.Times)
		for _, t := range ev.Times {
			if t.At < earliest || t.At > latest {
				utils.SendBadRequest(w)
				return
			}
		}
	}
	if total > constants.MaxNotificationTimes {
		utils.SendBadRequest(w)
		return
	}

	ctx := r.Context()
	tx, err := database.DB.BeginTx(ctx, nil)
	if err != nil {
		utils.LogError("SyncNotifications", "BeginTx", err)
		utils.SendInternalError(w)
		return
	}
	defer func() { _ = tx.Rollback() }()

	marks := "?" + strings.Repeat(",?", len(ids)-1)

	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM calendar_events WHERE owner = ? AND id IN (`+marks+`)`,
		append([]any{user.UUID}, ids...)...,
	)
	if err != nil {
		utils.LogError("SyncNotifications", "QueryContext", err)
		utils.SendInternalError(w)
		return
	}
	owned := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			utils.LogError("SyncNotifications", "Scan", err)
			utils.SendInternalError(w)
			return
		}
		owned[strings.ToLower(id)] = true
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		utils.LogError("SyncNotifications", "rows.Err", err)
		utils.SendInternalError(w)
		return
	}
	_ = rows.Close()

	var subscription int64
	if req.Endpoint != "" {
		err := tx.QueryRowContext(ctx,
			`SELECT id FROM push_subscriptions WHERE owner = ? AND endpoint = ?`,
			user.UUID, req.Endpoint,
		).Scan(&subscription)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			utils.LogError("SyncNotifications", "QueryRowContext", err)
			utils.SendInternalError(w)
			return
		}
	}

	var (
		retry   = []string{}
		values  = []string{}
		args    = []any{}
		ownedID = []any{}
	)
	for _, ev := range req.Events {
		if !owned[ev.ID] {
			retry = append(retry, ev.ID)
			continue
		}
		ownedID = append(ownedID, ev.ID)
		skipped := false
		for _, t := range ev.Times {
			var sub any
			if t.Device {
				if subscription == 0 {
					skipped = true
					continue
				}
				sub = subscription
			}
			values = append(values, "(?,?,?,?)")
			args = append(args, user.UUID, ev.ID, sub, t.At)
		}
		if skipped {
			retry = append(retry, ev.ID)
		}
	}

	if len(ownedID) > 0 {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM scheduled_notifications
			WHERE owner = ? AND (subscription_id IS NULL OR subscription_id = ?)
			AND event_id IN (?`+strings.Repeat(",?", len(ownedID)-1)+`)`,
			append([]any{user.UUID, subscription}, ownedID...)...,
		); err != nil {
			utils.LogError("SyncNotifications", "delete", err)
			utils.SendInternalError(w)
			return
		}
	}

	if len(values) > 0 {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO scheduled_notifications (owner, event_id, subscription_id, fire_at) VALUES `+strings.Join(values, ","),
			args...,
		); err != nil {
			utils.LogError("SyncNotifications", "insert", err)
			utils.SendInternalError(w)
			return
		}
	}

	var count int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM scheduled_notifications WHERE owner = ?`,
		user.UUID,
	).Scan(&count); err != nil {
		utils.LogError("SyncNotifications", "count", err)
		utils.SendInternalError(w)
		return
	}
	if count > constants.MaxNotificationTimes {
		utils.SendJSON(w, http.StatusRequestEntityTooLarge, types.Reply[any]{
			Success: false,
			Message: "Notification limit reached.",
		})
		return
	}

	if err := tx.Commit(); err != nil {
		utils.LogError("SyncNotifications", "Commit", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[map[string][]string]{
		Success: true,
		Data:    map[string][]string{"retry": retry},
	})
}

type dueNotification struct {
	id           int64
	owner        string
	subscription sql.NullInt64
	fireAt       int64
}

func dispatchNotifications() {
	ticker := time.NewTicker(constants.NotificationTickEvery)
	defer ticker.Stop()

	for range ticker.C {
		sendDueNotifications(context.Background())
	}
}

// sendDueNotifications deletes every due row, then sends the ones that are not too late.
func sendDueNotifications(ctx context.Context) {
	now := time.Now()
	rows, err := database.Query(ctx,
		`SELECT id, owner, subscription_id, fire_at FROM scheduled_notifications WHERE fire_at <= ? ORDER BY fire_at`,
		now.UnixMilli(),
	)
	if err != nil {
		utils.LogError("sendDueNotifications", "Query", err)
		return
	}

	var due []dueNotification
	for rows.Next() {
		var n dueNotification
		if err := rows.Scan(&n.id, &n.owner, &n.subscription, &n.fireAt); err != nil {
			utils.LogError("sendDueNotifications", "Scan", err)
			continue
		}
		due = append(due, n)
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		utils.LogError("sendDueNotifications", "rows.Err", err)
		return
	}

	for _, n := range due {
		res, err := database.Exec(ctx, `DELETE FROM scheduled_notifications WHERE id = ?`, n.id)
		if err != nil {
			utils.LogError("sendDueNotifications", "Exec", err)
			continue
		}
		if deleted, _ := res.RowsAffected(); deleted == 0 {
			continue
		}
		if now.UnixMilli()-n.fireAt > constants.NotificationGrace.Milliseconds() {
			continue
		}

		if n.subscription.Valid {
			push.SendToSubscription(ctx, n.subscription.Int64, push.EventStartEvent())
		} else {
			push.SendToUser(ctx, n.owner, push.EventStartEvent())
		}
	}
}
