package handlers

import (
	"database/sql"
	"encoding/base64"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"

	"acLife/constants"
	"acLife/database"
	"acLife/push"
	"acLife/session"
	"acLife/types"
	"acLife/utils"

	"github.com/gorilla/mux"

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

// UpdateChallenge overwrites the caller's encrypted unlock-check blob.
func UpdateChallenge(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req struct {
		Challenge string `json:"challenge"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	if len(req.Challenge) == 0 || len(req.Challenge) > constants.MaxChallengeLen {
		utils.SendBadRequest(w)
		return
	}

	if _, err := database.Exec(r.Context(),
		"UPDATE users SET challenge = ? WHERE uuid = ?",
		req.Challenge, user.UUID,
	); err != nil {
		utils.LogError("UpdateChallenge", "database.Exec", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}

// ListSessions returns the user's active sessions.
func ListSessions(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	currentToken := session.Get[string](r, "access_token")

	rows, err := database.Query(r.Context(),
		"SELECT public_id, created_at, expires_at, access_token FROM account_sessions WHERE owner = ? ORDER BY created_at DESC",
		user.UUID,
	)
	if err != nil {
		utils.LogError("ListSessions", "database.Query", err)
		utils.SendInternalError(w)
		return
	}
	defer rows.Close()

	sessions := []types.Session{}
	for rows.Next() {
		var s types.Session
		var token string
		if err := rows.Scan(&s.ID, &s.CreatedAt, &s.ExpiresAt, &token); err != nil {
			utils.LogError("ListSessions", "rows.Scan", err)
			utils.SendInternalError(w)
			return
		}
		s.Current = token == currentToken
		sessions = append(sessions, s)
	}
	if err := rows.Err(); err != nil {
		utils.LogError("ListSessions", "rows.Err", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[[]types.Session]{
		Success: true,
		Data:    sessions,
	})
}

// RevokeSession terminates one of the user's sessions, identified by public_id.
func RevokeSession(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	publicID := mux.Vars(r)["id"]
	currentToken := session.Get[string](r, "access_token")

	var token string
	if err := database.QueryRow(r.Context(),
		"SELECT access_token FROM account_sessions WHERE public_id = ? AND owner = ?",
		publicID, user.UUID,
	).Scan(&token); err != nil {
		if err == sql.ErrNoRows {
			utils.SendJSON(w, http.StatusNotFound, types.Reply[any]{
				Success: false,
				Message: "Session not found.",
			})
			return
		}

		utils.LogError("RevokeSession", "database.QueryRow", err)
		utils.SendInternalError(w)
		return
	}

	if token == currentToken {
		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Cannot terminate the current session.",
		})
		return
	}

	if _, err := database.Exec(r.Context(),
		"DELETE FROM account_sessions WHERE public_id = ? AND owner = ?",
		publicID, user.UUID,
	); err != nil {
		utils.LogError("RevokeSession", "database.Exec", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
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
