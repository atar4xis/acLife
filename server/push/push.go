// Package push contains everything related to push services and notifications.
package push

import (
	"context"
	"encoding/json"
	"net/http"
	"os"

	"acLife/database"
	"acLife/types"
	"acLife/utils"

	"github.com/SherClockHolmes/webpush-go"
)

func send(
	ctx context.Context,
	sub types.PushSubscription,
	payload any,
) {
	data, err := json.Marshal(payload)
	if err != nil {
		utils.LogError("push.Send", "Marshal", err)
		return
	}

	resp, err := webpush.SendNotification(
		data,
		&webpush.Subscription{
			Endpoint: sub.Endpoint,
			Keys: webpush.Keys{
				P256dh: sub.P256DH,
				Auth:   sub.Auth,
			},
		},
		&webpush.Options{
			TTL:             60,
			VAPIDPublicKey:  os.Getenv("VAPID_PUBLIC_KEY"),
			VAPIDPrivateKey: os.Getenv("VAPID_PRIVATE_KEY"),
		},
	)
	if err != nil {
		utils.LogError("push.Send", "SendNotification", err)
		return
	}

	defer func() { _ = resp.Body.Close() }()

	// Delete invalid or expired subscriptions
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
		if _, err = database.Exec(ctx,
			`DELETE FROM push_subscriptions WHERE endpoint = ?`,
			sub.Endpoint,
		); err != nil {
			utils.LogError("push.Send", "Exec", err)
			return
		}
	}
}

// SendToUser sends a JSON-serializable payload to the user's push subscriptions.
func SendToUser(
	ctx context.Context,
	uuid string,
	payload any,
) {
	rows, err := database.Query(ctx, `
		SELECT endpoint, p256dh, auth
		FROM push_subscriptions
		WHERE owner = ?`,
		uuid,
	)
	if err != nil {
		utils.LogError("push.SendToUser", "Query", err)
		return
	}

	defer func() { _ = rows.Close() }()

	// Send to all subscriptions
	for rows.Next() {
		var sub types.PushSubscription
		if err := rows.Scan(&sub.Endpoint, &sub.P256DH, &sub.Auth); err != nil {
			utils.LogError("push.SendToUser", "Scan", err)
			continue
		}

		send(ctx, sub, payload)
	}
}

func NotificationEvent(title string, body string) types.PushEvent {
	return types.PushEvent{
		Type:  "notification",
		Title: title,
		Body:  body,
	}
}

func SyncEvent(originClientID string) types.PushEvent {
	return types.PushEvent{
		Type:           "sync",
		OriginClientID: originClientID,
	}
}
