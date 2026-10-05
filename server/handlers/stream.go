package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/session"
	"acLife/stream"
	"acLife/types"
	"acLife/utils"
)

// afterSubscribe lets tests change state at the moment closers can no longer miss the stream.
var afterSubscribe func()

// Stream forwards the user's messages until the session ends, expires or loses its subscription.
func Stream(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	token := session.Get[string](r, "access_token")

	conn, ok := stream.Subscribe(user.UUID, token)
	if !ok {
		utils.SendJSON(w, http.StatusTooManyRequests, types.Reply[any]{
			Success: false,
			Message: "Too many open streams.",
			Code:    "too_many_requests",
		})
		return
	}
	defer conn.Close()

	if afterSubscribe != nil {
		afterSubscribe()
	}

	// a close that ran before Subscribe found nothing to close, so check again now that it is registered
	if !stillAllowed(w, r) {
		return
	}

	var expiresAt time.Time
	if err := database.QueryRow(r.Context(),
		"SELECT expires_at FROM account_sessions WHERE access_token = ?",
		token,
	).Scan(&expiresAt); err != nil {
		utils.LogError("Stream", "QueryRow", err)
		utils.SendInternalError(w)
		return
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no") // stop nginx from buffering the stream
	w.WriteHeader(http.StatusOK)

	rc := http.NewResponseController(w)
	if writeMessage(w, stream.Message{Type: "hello", Seq: conn.Seq}) != nil || rc.Flush() != nil {
		return
	}

	heartbeat := time.NewTicker(constants.StreamHeartbeat)
	defer heartbeat.Stop()
	expiry := time.NewTimer(time.Until(expiresAt))
	defer expiry.Stop()

	for {
		var err error
		select {
		case <-r.Context().Done():
			return
		case <-expiry.C:
			return
		case ev, ok := <-conn.Messages:
			if !ok {
				return
			}
			err = writeMessage(w, ev)
		case <-heartbeat.C:
			_, err = fmt.Fprint(w, "event: ping\ndata: {}\n\n")
		}

		if err != nil || rc.Flush() != nil {
			return
		}
	}
}

func writeMessage(w http.ResponseWriter, ev stream.Message) error {
	data, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, data)
	return err
}

// stillAllowed re-reads the account and answers the request itself when the stream must not open.
func stillAllowed(w http.ResponseWriter, r *http.Request) bool {
	user := session.GetLoggedInUser(r, true)
	if user == nil {
		utils.SendJSON(w, http.StatusUnauthorized, types.Reply[any]{
			Success: false,
			Message: "You are not logged in.",
			Code:    "not_logged_in",
		})
		return false
	}

	if constants.Metadata.Registration.Email.VerificationRequired && !user.EmailVerified {
		utils.SendJSON(w, http.StatusForbidden, types.Reply[any]{
			Success: false,
			Message: "Email verification required.",
			Code:    "email_verification_required",
		})
		return false
	}

	if constants.Metadata.Registration.SubscriptionRequired {
		status := ""
		if user.SubscriptionStatus != nil {
			status = *user.SubscriptionStatus
		}
		if status != "active" && status != "trialing" {
			denySubscription(w)
			return false
		}
	}

	return true
}
