package handlers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"

	"acLife/constants"
	"acLife/database"
	"acLife/push"
	"acLife/session"
	"acLife/stream"
	"acLife/types"
	"acLife/utils"

	"github.com/gorilla/mux"

	"mz.attahri.com/code/srp/v3"

	_ "crypto/sha256"
)

func UserInfo(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	envelopes, err := fetchEnvelopes(r.Context(), user.UUID)
	if err != nil {
		utils.LogError("UserInfo", "fetchEnvelopes", err)
		utils.SendInternalError(w)
		return
	}

	// Respond with JSON (only exposing what needs to be)
	utils.SendJSON(w, http.StatusOK, types.Reply[types.PublicUser]{
		Success: true,
		Data: types.PublicUser{
			UUID:               user.UUID,
			Email:              user.Email,
			SubscriptionStatus: user.SubscriptionStatus,
			Envelopes:          envelopes,
		},
	})
}

// fetchEnvelopes loads all key envelopes belonging to owner.
func fetchEnvelopes(ctx context.Context, owner string) ([]types.KeyEnvelope, error) {
	rows, err := database.Query(ctx,
		"SELECT type, version, salt, data, kdf_params FROM key_envelopes WHERE owner = ?",
		owner,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	envelopes := []types.KeyEnvelope{}
	for rows.Next() {
		var e types.KeyEnvelope
		if err := rows.Scan(&e.Type, &e.Version, &e.Salt, &e.Data, &e.KDFParams); err != nil {
			return nil, err
		}
		envelopes = append(envelopes, e)
	}

	return envelopes, rows.Err()
}

// upsertEnvelopesTx inserts or updates key envelopes for owner within tx.
func upsertEnvelopesTx(ctx context.Context, tx *sql.Tx, owner string, envelopes []types.KeyEnvelope) error {
	for _, e := range envelopes {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO key_envelopes (owner, type, version, salt, data, kdf_params)
			VALUES (?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE version=VALUES(version), salt=VALUES(salt), data=VALUES(data), kdf_params=VALUES(kdf_params)`,
			owner, e.Type, e.Version, e.Salt, e.Data, e.KDFParams,
		); err != nil {
			return err
		}
	}

	return nil
}

// UpdateEmail changes the caller's email and SRP credentials from a client-generated triplet.
func UpdateEmail(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req struct {
		reauthProof
		Triplet []byte `json:"triplet"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	var triplet srp.Triplet = req.Triplet

	if len(triplet.Username()) == 0 || len(triplet.Verifier()) == 0 || len(triplet.Salt()) == 0 {
		utils.SendBadRequest(w)
		return
	}

	if len(triplet.Username()) > constants.MaxEmailLen ||
		len(triplet.Salt()) > constants.MaxSaltLen ||
		len(triplet.Verifier()) > constants.MaxVerifierLen {
		utils.SendBadRequest(w)
		return
	}

	if !requirePassword(w, r, user, req.reauthProof) {
		return
	}

	if !utils.ValidateEmail(triplet.Username()) {
		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Invalid email address.",
			Code:    "invalid_email",
		})
		return
	}

	if !utils.IsEmailDomainAllowed(triplet.Username()) {
		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Emails from this domain are not allowed.",
			Code:    "email_domain_not_allowed",
		})
		return
	}

	newEmail := triplet.Username()
	verificationRequired := constants.Metadata.Registration.Email.VerificationRequired

	ctx := r.Context()
	tx, err := database.DB.BeginTx(ctx, nil)
	if err != nil {
		utils.LogError("UpdateEmail", "BeginTx", err)
		utils.SendInternalError(w)
		return
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		"UPDATE users SET email = ?, srp_salt = ?, verifier = ?, email_verified = 0 WHERE uuid = ?",
		newEmail, triplet.Salt(), triplet.Verifier(), user.UUID,
	); err != nil {
		if database.IsDuplicateEntry(err) {
			utils.SendJSON(w, http.StatusConflict, types.Reply[any]{
				Success: false,
				Message: "Email already in use.",
				Code:    "email_in_use",
			})
			return
		}

		utils.LogError("UpdateEmail", "tx.Exec(update users)", err)
		utils.SendInternalError(w)
		return
	}

	// a token issued for the old email must not verify the new one
	if _, err := tx.ExecContext(ctx, "DELETE FROM email_verification_tokens WHERE owner = ?", user.UUID); err != nil {
		utils.LogError("UpdateEmail", "tx.Exec(delete token)", err)
		utils.SendInternalError(w)
		return
	}

	if verificationRequired {
		if err := queueVerificationTokenTx(ctx, tx, user.UUID, newEmail, utils.PreferredLanguage(r, verificationEmailLanguages())); err != nil {
			replyMailError(w, "UpdateEmail", "queueVerificationTokenTx", err)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		utils.LogError("UpdateEmail", "tx.Commit", err)
		utils.SendInternalError(w)
		return
	}

	if !verificationRequired {
		utils.SendJSON(w, http.StatusOK, types.Reply[any]{
			Success: true,
		})
		return
	}

	accessToken := session.Get[string](r, "access_token")
	if accessToken != "" {
		_, _ = database.Exec(r.Context(),
			"DELETE FROM account_sessions WHERE access_token = ?",
			accessToken)
	}
	stream.CloseUser(user.UUID, "") // every session needs the new email verified
	if err := session.DestroySession(w, r); err != nil {
		utils.LogError("UpdateEmail", "session.DestroySession", err)
	}

	utils.SendJSON(w, http.StatusForbidden, types.Reply[types.EmailUnverifiedData]{
		Success: false,
		Message: "Email verification required.",
		Code:    "email_verification_required",
		Data: types.EmailUnverifiedData{
			Email:                newEmail,
			RequiresVerification: true,
		},
	})
}

// UpdatePassword updates SRP credentials and the re-wrapped master key envelope together.
func UpdatePassword(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req struct {
		reauthProof
		Triplet   []byte              `json:"triplet"`
		Envelopes []types.KeyEnvelope `json:"envelopes"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	var triplet srp.Triplet = req.Triplet

	if len(triplet.Username()) == 0 || len(triplet.Verifier()) == 0 || len(triplet.Salt()) == 0 {
		utils.SendBadRequest(w)
		return
	}

	if len(triplet.Salt()) > constants.MaxSaltLen || len(triplet.Verifier()) > constants.MaxVerifierLen {
		utils.SendBadRequest(w)
		return
	}

	if !validateEnvelopes(req.Envelopes) {
		utils.SendBadRequest(w)
		return
	}

	if !requirePassword(w, r, user, req.reauthProof) {
		return
	}

	ctx := r.Context()
	tx, err := database.DB.BeginTx(ctx, nil)
	if err != nil {
		utils.LogError("UpdatePassword", "BeginTx", err)
		utils.SendInternalError(w)
		return
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		"UPDATE users SET srp_salt = ?, verifier = ? WHERE uuid = ?",
		triplet.Salt(), triplet.Verifier(), user.UUID,
	); err != nil {
		utils.LogError("UpdatePassword", "tx.Exec(update users)", err)
		utils.SendInternalError(w)
		return
	}

	if err := upsertEnvelopesTx(ctx, tx, user.UUID, req.Envelopes); err != nil {
		utils.LogError("UpdatePassword", "upsertEnvelopesTx", err)
		utils.SendInternalError(w)
		return
	}

	// changing the password should invalidate every other session
	currentToken := session.Get[string](r, "access_token")
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM account_sessions WHERE owner = ? AND access_token != ?",
		user.UUID, currentToken,
	); err != nil {
		utils.LogError("UpdatePassword", "tx.Exec(revoke sessions)", err)
		utils.SendInternalError(w)
		return
	}

	if err := tx.Commit(); err != nil {
		utils.LogError("UpdatePassword", "tx.Commit", err)
		utils.SendInternalError(w)
		return
	}

	stream.CloseUser(user.UUID, currentToken)

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}

// fetchSettings returns the stored settings blob, or version 0 with no data if none exists.
func fetchSettings(ctx context.Context, owner string) (types.EncryptedSettings, error) {
	var s types.EncryptedSettings
	err := database.QueryRow(ctx,
		"SELECT data, version FROM user_settings WHERE owner = ?",
		owner,
	).Scan(&s.Data, &s.Version)
	if errors.Is(err, sql.ErrNoRows) {
		return types.EncryptedSettings{}, nil
	}
	return s, err
}

// writeSettings reports false when the stored version no longer matches req.BaseVersion.
func writeSettings(ctx context.Context, owner string, req types.SaveSettingsRequest) (bool, error) {
	if req.BaseVersion == 0 {
		_, err := database.Exec(ctx,
			"INSERT INTO user_settings (owner, data) VALUES (?, ?)",
			owner, req.Data,
		)
		if database.IsDuplicateEntry(err) {
			return false, nil
		}
		return err == nil, err
	}

	res, err := database.Exec(ctx,
		"UPDATE user_settings SET data = ?, version = version + 1 WHERE owner = ? AND version = ?",
		req.Data, owner, req.BaseVersion,
	)
	if err != nil {
		return false, err
	}

	n, err := res.RowsAffected()
	return n > 0, err
}

// GetSettings returns the caller's encrypted settings blob.
func GetSettings(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	settings, err := fetchSettings(r.Context(), user.UUID)
	if err != nil {
		utils.LogError("GetSettings", "fetchSettings", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[types.EncryptedSettings]{
		Success: true,
		Data:    settings,
	})
}

// SaveSettings replaces the caller's encrypted settings blob, rejecting stale writes with 409.
func SaveSettings(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req types.SaveSettingsRequest
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	if len(req.Data) == 0 || len(req.Data) > constants.MaxSettingsBytes || req.BaseVersion < 0 {
		utils.SendBadRequest(w)
		return
	}

	ctx := r.Context()
	saved, err := writeSettings(ctx, user.UUID, req)
	if err != nil {
		utils.LogError("SaveSettings", "writeSettings", err)
		utils.SendInternalError(w)
		return
	}

	if !saved {
		current, err := fetchSettings(ctx, user.UUID)
		if err != nil {
			utils.LogError("SaveSettings", "fetchSettings", err)
			utils.SendInternalError(w)
			return
		}

		utils.SendJSON(w, http.StatusConflict, types.Reply[types.EncryptedSettings]{
			Message: "version conflict",
			Data:    current,
		})
		return
	}

	originClientID := r.URL.Query().Get("c")
	if len(originClientID) == 6 {
		stream.Publish(user.UUID, stream.Settings(originClientID))
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
	defer func() { _ = rows.Close() }()

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
				Code:    "session_not_found",
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
			Code:    "cannot_end_current_session",
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

	stream.CloseSession(token)

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
	if allowed == "" {
		allowed = constants.DefaultPushAllowedEndpoints
	}

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

// PushUnsubscribe removes a push service subscription from the DB.
func PushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req struct {
		Endpoint string `json:"endpoint"`
	}

	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	if req.Endpoint == "" {
		utils.SendBadRequest(w)
		return
	}

	if _, err := database.Exec(r.Context(),
		"DELETE FROM push_subscriptions WHERE owner = ? AND endpoint = ?",
		user.UUID, req.Endpoint,
	); err != nil {
		utils.LogError("PushUnsubscribe", "database.Exec", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}

// PushCheck reports whether the server still has the caller's push subscription.
func PushCheck(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req struct {
		Endpoint string `json:"endpoint"`
	}

	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	var known bool
	if err := database.QueryRow(r.Context(),
		"SELECT EXISTS(SELECT 1 FROM push_subscriptions WHERE owner = ? AND endpoint = ?)",
		user.UUID, req.Endpoint,
	).Scan(&known); err != nil {
		utils.LogError("PushCheck", "database.QueryRow", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[map[string]bool]{
		Success: true,
		Data:    map[string]bool{"known": known},
	})
}

// PushTest sends a test notification to the user.
func PushTest(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	switch r.URL.Query().Get("type") {
	case "notification":
		push.SendToUser(r.Context(), user.UUID, push.NotificationEvent("Test Notification", "You are user: "+user.UUID))
	case "event-start":
		push.SendToUser(r.Context(), user.UUID, push.EventStartEvent())
	case "sync":
		stream.Publish(user.UUID, stream.Sync(r.URL.Query().Get("origin")))
	default:
		utils.SendBadRequest(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}
