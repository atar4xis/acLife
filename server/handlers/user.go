package handlers

import (
	"encoding/base64"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"

	"acLife/database"
	"acLife/push"
	"acLife/session"
	"acLife/types"
	"acLife/utils"

	_ "crypto/sha256"
)

func UserInfo(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	// Respond with JSON (only exposing what needs to be)
	// TODO: send Salt and Challenge only when requested
	utils.SendJSON(w, http.StatusOK, types.Reply[types.PublicUser]{
		Success: true,
		Data: types.PublicUser{
			UUID:               user.UUID,
			Email:              user.Email,
			SubscriptionStatus: user.SubscriptionStatus,
			Salt:               user.Salt,
			Challenge:          user.Challenge,
		},
	})
}

// PushSubscribe stores a push service subscription in the DB.
func PushSubscribe(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req struct {
		Endpoint string `json:"endpoint"`
		Auth     string `json:"auth"`
		P256DH   string `json:"p256dh"`
	}

	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	// Validate endpoint: valid, absolute, https URL
	u, err := url.Parse(req.Endpoint)
	if err != nil || !u.IsAbs() || u.Scheme != "https" {
		utils.SendBadRequest(w)
		return
	}

	// Make sure the endpoint is allowed
	allowed := os.Getenv("PUSH_ALLOWED_ENDPOINTS")
	if allowed != "" {
		host := u.Hostname()
		found := false

		for pattern := range strings.SplitSeq(allowed, ",") {
			pattern = strings.TrimSpace(pattern)
			if pattern == "" {
				continue
			}

			re := "^" + regexp.QuoteMeta(pattern) + "$"
			re = strings.ReplaceAll(re, `\*`, ".*")

			matched, _ := regexp.MatchString(re, host)

			if matched {
				found = true
				break
			}
		}

		if !found {
			utils.SendBadRequest(w)
			return
		}
	}

	// Validate auth: valid base64 and 16 bytes long
	authBytes, err := base64.RawURLEncoding.DecodeString(req.Auth)
	if err != nil || len(authBytes) != 16 {
		utils.SendBadRequest(w)
		return
	}

	// Validate p256dh: valid base64 and 65 bytes long
	p256dhBytes, err := base64.RawURLEncoding.DecodeString(req.P256DH)
	if err != nil || len(p256dhBytes) != 65 {
		utils.SendBadRequest(w)
		return
	}

	// Upsert into database
	if _, err := database.Exec(r.Context(), `
		INSERT INTO push_subscriptions (owner, endpoint, p256dh, auth)
		VALUES (?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			owner = VALUES(owner),
			p256dh = VALUES(p256dh),
			auth = VALUES(auth);`,
		user.UUID, req.Endpoint, req.P256DH, req.Auth,
	); err != nil {
		utils.LogError("PushSubscribe", "database.Exec", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}

// PushTest sends a test notification to the user.
func PushTest(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	switch r.URL.Query().Get("type") {
	case "notification":
		push.SendToUser(r.Context(), user.UUID, push.NotificationEvent("Test Notification", "You are user: "+user.UUID))
	case "sync":
		push.SendToUser(r.Context(), user.UUID, push.SyncEvent(r.URL.Query().Get("origin")))
	default:
		utils.SendBadRequest(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}
