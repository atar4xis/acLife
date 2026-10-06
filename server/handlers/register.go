package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/http"
	"sync"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/mail"
	"acLife/types"
	"acLife/utils"

	"mz.attahri.com/code/srp/v3"
)

var registrationMailLimits = []struct {
	n      int
	window time.Duration
}{
	{constants.RegistrationMailsPerMinute, time.Minute},
	{constants.RegistrationMailsPerHour, time.Hour},
	{constants.RegistrationMailsPerDay, constants.Day},
}

var registrationMails sync.Mutex

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func validCredentials(triplet srp.Triplet, envelopes []types.KeyEnvelope) bool {
	return len(triplet.Username()) > 0 && len(triplet.Verifier()) > 0 && len(triplet.Salt()) > 0 &&
		len(triplet.Username()) <= constants.MaxEmailLen &&
		len(triplet.Salt()) <= constants.MaxSaltLen &&
		len(triplet.Verifier()) <= constants.MaxVerifierLen &&
		validateEnvelopes(envelopes)
}

func insertAccount(ctx context.Context, tx *sql.Tx, triplet srp.Triplet, envelopes []types.KeyEnvelope, verified bool) error {
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO users (email, srp_salt, verifier, email_verified)
		VALUES (?, ?, ?, ?)`,
		triplet.Username(), triplet.Salt(), triplet.Verifier(), verified,
	); err != nil {
		return err
	}

	var userUUID string
	if err := tx.QueryRowContext(ctx,
		"SELECT uuid FROM users WHERE email = ?",
		triplet.Username(),
	).Scan(&userUUID); err != nil {
		return err
	}

	for _, e := range envelopes {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO key_envelopes (owner, type, version, salt, data, kdf_params)
			VALUES (?, ?, ?, ?, ?, ?)`,
			userUUID, e.Type, e.Version, e.Salt, e.Data, e.KDFParams,
		); err != nil {
			return err
		}
	}

	return nil
}

func registrationMailWait(ctx context.Context, email string, now time.Time) (time.Duration, error) {
	rows, err := database.Query(ctx,
		"SELECT created_at FROM pending_registrations WHERE email = ? AND created_at > ? ORDER BY created_at DESC",
		email, now.Add(-constants.PendingRegistrationTTL),
	)
	if err != nil {
		return 0, err
	}
	defer func() { _ = rows.Close() }()

	var sent []time.Time
	for rows.Next() {
		var createdAt time.Time
		if err := rows.Scan(&createdAt); err != nil {
			return 0, err
		}
		sent = append(sent, createdAt)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	var wait time.Duration
	for _, limit := range registrationMailLimits {
		if len(sent) >= limit.n && now.Sub(sent[limit.n-1]) < limit.window {
			wait = max(wait, sent[limit.n-1].Add(limit.window).Sub(now))
		}
	}
	return wait, nil
}

func queueRegistrationMail(ctx context.Context, email, lang string) error {
	token := utils.RandomToken(32)
	now := time.Now()

	tx, err := database.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		"INSERT INTO pending_registrations (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
		hashToken(token), email, now, now.Add(constants.PendingRegistrationTTL),
	); err != nil {
		return err
	}

	subject, body := registrationEmailContent(token, email, lang)
	if err := mail.QueueMail(ctx, tx, email, subject, body); err != nil {
		return err
	}

	return tx.Commit()
}

func RegisterStart(w http.ResponseWriter, r *http.Request) {
	if !constants.Metadata.Registration.Enabled || !constants.Metadata.Registration.Email.VerificationRequired {
		utils.SendBadRequest(w)
		return
	}

	var req struct {
		Email        string `json:"email"`
		ConfirmEmail string `json:"confirmEmail"`
		PowToken     string `json:"powToken"`
		PowNonce     string `json:"powNonce"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	type startData struct {
		Registered bool `json:"registered"`
	}
	reply := func(registered bool) {
		utils.SendJSON(w, http.StatusOK, types.Reply[startData]{
			Success: true,
			Data:    startData{Registered: registered},
		})
	}

	if req.ConfirmEmail != "" {
		reply(false)
		return
	}

	if len(req.Email) == 0 || len(req.Email) > constants.MaxEmailLen ||
		len(req.PowToken) == 0 || len(req.PowToken) > constants.MaxPowTokenLen ||
		len(req.PowNonce) == 0 || len(req.PowNonce) > constants.MaxPowNonceLen {
		utils.SendBadRequest(w)
		return
	}

	if !utils.ValidateEmail(req.Email) {
		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Invalid email address.",
			Code:    "invalid_email",
		})
		return
	}

	if !utils.IsEmailDomainAllowed(req.Email) {
		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Emails from this domain are not allowed.",
			Code:    "email_domain_not_allowed",
		})
		return
	}

	if !verifyPowProof(req.PowToken, req.PowNonce, req.Email) {
		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Request verification failed. Please try again.",
			Code:    "request_verification_failed",
		})
		return
	}

	ctx := r.Context()

	var registered bool
	if err := database.QueryRow(ctx,
		"SELECT EXISTS(SELECT 1 FROM users WHERE email = ?)",
		req.Email,
	).Scan(&registered); err != nil {
		utils.LogError("RegisterStart", "QueryRow(users)", err)
		utils.SendInternalError(w)
		return
	}
	if registered {
		reply(true)
		return
	}

	registrationMails.Lock()
	defer registrationMails.Unlock()

	wait, err := registrationMailWait(ctx, req.Email, time.Now())
	if err != nil {
		utils.LogError("RegisterStart", "registrationMailWait", err)
		utils.SendInternalError(w)
		return
	}

	if wait == 0 {
		if err := queueRegistrationMail(ctx, req.Email, utils.PreferredLanguage(r, verificationEmailLanguages())); err != nil {
			utils.LogError("RegisterStart", "queueRegistrationMail", err)
			utils.SendInternalError(w)
			return
		}
	}

	reply(false)
}

func RegisterComplete(w http.ResponseWriter, r *http.Request) {
	if !constants.Metadata.Registration.Enabled || !constants.Metadata.Registration.Email.VerificationRequired {
		utils.SendBadRequest(w)
		return
	}

	var req struct {
		Token     string              `json:"token"`
		Triplet   []byte              `json:"triplet"`
		Envelopes []types.KeyEnvelope `json:"envelopes"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	var triplet srp.Triplet = req.Triplet

	if len(req.Token) == 0 || len(req.Token) > constants.MaxPowTokenLen || !validCredentials(triplet, req.Envelopes) {
		utils.SendBadRequest(w)
		return
	}

	ctx := r.Context()
	tx, err := database.DB.BeginTx(ctx, nil)
	if err != nil {
		utils.LogError("RegisterComplete", "BeginTx", err)
		utils.SendInternalError(w)
		return
	}
	defer func() { _ = tx.Rollback() }()

	var email string
	if err := tx.QueryRowContext(ctx,
		"SELECT email FROM pending_registrations WHERE token_hash = ? AND expires_at > ? FOR UPDATE",
		hashToken(req.Token), time.Now(),
	).Scan(&email); err != nil {
		if err != sql.ErrNoRows {
			utils.LogError("RegisterComplete", "QueryRow(pending_registrations)", err)
			utils.SendInternalError(w)
			return
		}

		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Verification link invalid or expired.",
			Code:    "verification_link_invalid",
		})
		return
	}

	if triplet.Username() != email {
		utils.SendBadRequest(w)
		return
	}

	if !utils.IsEmailDomainAllowed(email) {
		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Emails from this domain are not allowed.",
			Code:    "email_domain_not_allowed",
		})
		return
	}

	if err := insertAccount(ctx, tx, triplet, req.Envelopes, true); err != nil {
		if database.IsDuplicateEntry(err) {
			utils.SendJSON(w, http.StatusConflict, types.Reply[any]{
				Success: false,
				Message: "Email already in use.",
				Code:    "email_in_use",
			})
			return
		}

		utils.LogError("RegisterComplete", "insertAccount", err)
		utils.SendInternalError(w)
		return
	}

	if _, err := tx.ExecContext(ctx, "DELETE FROM pending_registrations WHERE email = ?", email); err != nil {
		utils.LogError("RegisterComplete", "tx.Exec(delete pending)", err)
		utils.SendInternalError(w)
		return
	}

	if err := tx.Commit(); err != nil {
		utils.LogError("RegisterComplete", "tx.Commit", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}

func resendPendingRegistration(w http.ResponseWriter, r *http.Request, email string) bool {
	ctx := r.Context()

	var pending bool
	if err := database.QueryRow(ctx,
		"SELECT EXISTS(SELECT 1 FROM pending_registrations WHERE email = ? AND expires_at > ?)",
		email, time.Now(),
	).Scan(&pending); err != nil {
		utils.LogError("ResendVerification", "QueryRow(pending_registrations)", err)
		utils.SendInternalError(w)
		return true
	}
	if !pending {
		return false
	}

	registrationMails.Lock()
	defer registrationMails.Unlock()

	now := time.Now()
	wait, err := registrationMailWait(ctx, email, now)
	if err != nil {
		utils.LogError("ResendVerification", "registrationMailWait", err)
		utils.SendInternalError(w)
		return true
	}

	if wait > 0 {
		replyTooManyAttempts(w, wait)
		return true
	}

	if err := queueRegistrationMail(ctx, email, utils.PreferredLanguage(r, verificationEmailLanguages())); err != nil {
		utils.LogError("ResendVerification", "queueRegistrationMail", err)
		utils.SendInternalError(w)
		return true
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
		Message: "Verification email sent.",
		Code:    "verification_email_sent",
	})
	return true
}

func replyTooManyAttempts(w http.ResponseWriter, wait time.Duration) {
	if wait <= time.Minute {
		seconds := int(wait.Seconds()) + 1
		utils.SendJSON(w, http.StatusTooManyRequests, types.Reply[any]{
			Success: false,
			Message: fmt.Sprintf("Too many attempts. Try again in %d seconds.", seconds),
			Code:    "too_many_attempts_seconds",
			Params:  map[string]any{"count": seconds},
		})
		return
	}

	replyLocked(w, wait)
}

func deleteStalePendingRegistrations(ctx context.Context, now time.Time) error {
	_, err := database.Exec(ctx,
		"DELETE FROM pending_registrations WHERE created_at < ?",
		now.Add(-constants.PendingRegistrationTTL),
	)
	return err
}
