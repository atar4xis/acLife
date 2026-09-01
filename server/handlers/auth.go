package handlers

import (
	"context"
	"crypto"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/bits"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/mail"
	"acLife/session"
	"acLife/types"
	"acLife/utils"

	"mz.attahri.com/code/srp/v3"
)

var srpSessionStore = sync.Map{} // map[string]types.SRPSession

func init() {
	go cleanupSRPSessions()
	go cleanupAccountSessions()
	go cleanupExpiredVerifications()
}

/* -------------------- Cleanup -------------------- */

func cleanupSRPSessions() {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		srpSessionStore.Range(func(key, value any) bool {
			s := value.(types.SRPSession)
			if now.Sub(s.CreatedAt) > constants.SRPSessionTTL {
				srpSessionStore.Delete(key)
			}
			return true
		})
	}
}

func cleanupAccountSessions() {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()

		if _, err := database.Exec(context.Background(),
			"DELETE FROM account_sessions WHERE expires_at < ?",
			now,
		); err != nil {
			utils.LogError("cleanupAccountSessions", "Exec", err)
		}
	}
}

// cleanupExpiredVerifications deletes expired, unverified accounts, keeping those with a subscription or calendar events.
func cleanupExpiredVerifications() {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		ctx := context.Background()
		now := time.Now()

		deletableEmails, err := collectEmails(ctx, `
			SELECT u.email FROM users u
			JOIN email_verification_tokens t ON t.owner = u.uuid
			WHERE t.expires_at < ?
				AND u.email_verified = 0
				AND u.stripe_subscription_id IS NULL
				AND NOT EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.owner = u.uuid)`,
			now,
		)
		if err != nil {
			utils.LogError("cleanupExpiredVerifications", "collectEmails(deletable)", err)
		}

		if _, err := database.Exec(ctx, `
			DELETE u FROM users u
			JOIN email_verification_tokens t ON t.owner = u.uuid
			WHERE t.expires_at < ?
				AND u.email_verified = 0
				AND u.stripe_subscription_id IS NULL
				AND NOT EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.owner = u.uuid)`,
			now,
		); err != nil {
			utils.LogError("cleanupExpiredVerifications", "Exec(delete users)", err)
		}

		for _, email := range deletableEmails {
			if err := mail.CancelQueuedMails(ctx, database.DB, email); err != nil {
				utils.LogError("cleanupExpiredVerifications", "mail.CancelQueuedMails", err)
			}
		}

		protectedEmails, err := collectEmails(ctx, `
			SELECT u.email FROM users u
			JOIN email_verification_tokens t ON t.owner = u.uuid
			WHERE t.expires_at < ?
				AND u.email_verified = 0
				AND (u.stripe_subscription_id IS NOT NULL
					OR EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.owner = u.uuid))`,
			now,
		)
		if err != nil {
			utils.LogError("cleanupExpiredVerifications", "collectEmails(protected)", err)
		}

		if _, err := database.Exec(ctx, `
			DELETE t FROM email_verification_tokens t
			JOIN users u ON u.uuid = t.owner
			WHERE t.expires_at < ?
				AND u.email_verified = 0
				AND (u.stripe_subscription_id IS NOT NULL
					OR EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.owner = u.uuid))`,
			now,
		); err != nil {
			utils.LogError("cleanupExpiredVerifications", "Exec(clear protected tokens)", err)
		}

		for _, email := range protectedEmails {
			if err := mail.CancelQueuedMails(ctx, database.DB, email); err != nil {
				utils.LogError("cleanupExpiredVerifications", "mail.CancelQueuedMails", err)
			}
		}

		if _, err := database.Exec(ctx, `
			DELETE t FROM email_verification_tokens t
			JOIN users u ON u.uuid = t.owner
			WHERE u.email_verified = 1`,
		); err != nil {
			utils.LogError("cleanupExpiredVerifications", "Exec(delete verified tokens)", err)
		}
	}
}

// collectEmails runs a query selecting a single email column and returns the results.
func collectEmails(ctx context.Context, query string, args ...any) ([]string, error) {
	rows, err := database.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var emails []string
	for rows.Next() {
		var email string
		if err := rows.Scan(&email); err != nil {
			return nil, err
		}
		emails = append(emails, email)
	}

	return emails, rows.Err()
}

// userHasProtectedData reports whether user with uuid has a subscription or calendar events.
func userHasProtectedData(ctx context.Context, uuid string) (bool, error) {
	var hasSubscription bool
	if err := database.QueryRow(ctx,
		"SELECT stripe_subscription_id IS NOT NULL FROM users WHERE uuid = ?",
		uuid,
	).Scan(&hasSubscription); err != nil {
		return false, err
	}

	if hasSubscription {
		return true, nil
	}

	var hasEvents bool
	if err := database.QueryRow(ctx,
		"SELECT EXISTS(SELECT 1 FROM calendar_events WHERE owner = ?)",
		uuid,
	).Scan(&hasEvents); err != nil {
		return false, err
	}

	return hasEvents, nil
}

// createAndQueueVerificationToken generates a fresh verification token for the given user, stores it, and queues it for the background worker to send.
func createAndQueueVerificationToken(ctx context.Context, email string) error {
	var uuid string
	if err := database.QueryRow(ctx,
		"SELECT uuid FROM users WHERE email = ?",
		email,
	).Scan(&uuid); err != nil {
		return err
	}

	token := utils.RandomToken(32)
	now := time.Now()
	expires := now.Add(constants.EmailVerificationTTL)

	if _, err := database.Exec(ctx, `
		INSERT INTO email_verification_tokens (owner, token, expires_at, last_sent_at, send_window_start, send_count)
		VALUES (?, ?, ?, ?, ?, 1)`,
		uuid, token, expires, now, now,
	); err != nil {
		if database.IsDuplicateEntry(err) {
			return nil
		}
		return err
	}

	// Clear any previously queued email for this address.
	if err := mail.CancelQueuedMails(ctx, database.DB, email); err != nil {
		return err
	}

	subject, body := verificationEmailContent(token)
	return mail.QueueMail(ctx, database.DB, email, subject, body)
}

// queueVerificationTokenTx is createAndQueueVerificationToken's transaction-scoped counterpart, used where the caller already holds a lock on the owner's email_verification_tokens row.
func queueVerificationTokenTx(ctx context.Context, tx *sql.Tx, uuid, email string) error {
	token := utils.RandomToken(32)
	now := time.Now()
	expires := now.Add(constants.EmailVerificationTTL)

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO email_verification_tokens (owner, token, expires_at, last_sent_at, send_window_start, send_count)
		VALUES (?, ?, ?, ?, ?, 1)`,
		uuid, token, expires, now, now,
	); err != nil {
		return err
	}

	if err := mail.CancelQueuedMails(ctx, tx, email); err != nil {
		return err
	}

	subject, body := verificationEmailContent(token)
	return mail.QueueMail(ctx, tx, email, subject, body)
}

// verificationEmailContent builds the subject and body of a verification email for the given token.
func verificationEmailContent(token string) (subject, body string) {
	verifyURL := strings.TrimRight(os.Getenv("SERVER_URL"), "/") + "/auth/verify-email?token=" + token

	subject = "Verify your email address for acLife"
	if tpl := os.Getenv("VERIFICATION_EMAIL_SUBJECT"); tpl != "" {
		subject = tpl
	}

	body = fmt.Sprintf(
		"Hi,\r\n\r\nPlease verify your email address for acLife using the link below:\r\n%s\r\n\r\n"+
			"This link expires in 24 hours. If you did not create an account, you can ignore this email.\r\n",
		verifyURL,
	)
	if tpl := os.Getenv("VERIFICATION_EMAIL_BODY"); tpl != "" {
		body = tpl
	}

	subject = strings.ReplaceAll(subject, "{url}", verifyURL)
	body = strings.ReplaceAll(body, "{url}", verifyURL)

	return subject, body
}

/* -------------------- Handlers -------------------- */

// powChallengeData is the signed, self-contained payload embedded in a PoW token.
// Bound to a specific email so a solved proof cannot be replayed.
type powChallengeData struct {
	Seed    string `json:"seed"`
	Email   string `json:"email"`
	Expires int64  `json:"expires"`
}

func signPowPayload(payload string) string {
	mac := hmac.New(sha256.New, []byte(os.Getenv("SESSION_KEY")))
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

// verifyPowProof checks that nonce solves the challenge bound to email inside token.
func verifyPowProof(token, nonce, email string) bool {
	payload, sig, ok := strings.Cut(token, ".")
	if !ok {
		return false
	}

	if !hmac.Equal([]byte(signPowPayload(payload)), []byte(sig)) {
		return false
	}

	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return false
	}

	var data powChallengeData
	if err := json.Unmarshal(raw, &data); err != nil {
		return false
	}

	if data.Email != email || time.Now().Unix() > data.Expires {
		return false
	}

	hash := sha256.Sum256([]byte(data.Seed + "|" + data.Email + "|" + nonce))

	zeroBits := 0
	for _, b := range hash {
		if b == 0 {
			zeroBits += 8
			continue
		}
		zeroBits += bits.LeadingZeros8(b)
		break
	}

	return zeroBits >= constants.PowDifficultyBits
}

// RegisterChallenge issues a proof-of-work challenge bound to an email address.
func RegisterChallenge(w http.ResponseWriter, r *http.Request) {
	if !constants.Metadata.Registration.Enabled {
		utils.SendBadRequest(w)
		return
	}

	var req struct {
		Email string `json:"email"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	if !utils.ValidateEmail(req.Email) || len(req.Email) > constants.MaxEmailLen {
		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Invalid email address.",
		})
		return
	}

	data := powChallengeData{
		Seed:    utils.RandomToken(16),
		Email:   req.Email,
		Expires: time.Now().Add(constants.PowChallengeTTL).Unix(),
	}

	raw, err := json.Marshal(data)
	if err != nil {
		utils.LogError("RegisterChallenge", "json.Marshal", err)
		utils.SendInternalError(w)
		return
	}

	payload := base64.RawURLEncoding.EncodeToString(raw)
	token := payload + "." + signPowPayload(payload)

	type PowData struct {
		Token      string `json:"token"`
		Difficulty int    `json:"difficulty"`
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[PowData]{
		Success: true,
		Data: PowData{
			Token:      token,
			Difficulty: constants.PowDifficultyBits,
		},
	})
}

// Register handles creating new accounts.
func Register(w http.ResponseWriter, r *http.Request) {
	if !constants.Metadata.Registration.Enabled {
		utils.SendBadRequest(w)
		return
	}

	var req struct {
		Challenge string `json:"challenge"`
		Triplet   []byte `json:"triplet"`
		Salt      []byte `json:"salt"`
		Email     string `json:"email"`
		PowToken  string `json:"powToken"`
		PowNonce  string `json:"powNonce"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	// Honeypot: bots fill this hidden field, real users never do.
	if req.Email != "" {
		utils.SendJSON(w, http.StatusOK, types.Reply[any]{
			Success: true,
		})
		return
	}

	var triplet srp.Triplet = req.Triplet
	challenge := req.Challenge

	// Make sure the fields are not empty
	if len(triplet.Username()) == 0 || len(triplet.Verifier()) == 0 || len(triplet.Salt()) == 0 ||
		len(challenge) == 0 || len(req.PowToken) == 0 || len(req.PowNonce) == 0 {
		utils.SendBadRequest(w)
		return
	}

	// Enforce max lengths
	if len(triplet.Username()) > constants.MaxEmailLen ||
		len(triplet.Salt()) > constants.MaxSaltLen ||
		len(req.Salt) > constants.MaxSaltLen ||
		len(triplet.Verifier()) > constants.MaxVerifierLen ||
		len(challenge) > constants.MaxChallengeLen ||
		len(req.PowToken) > constants.MaxPowTokenLen ||
		len(req.PowNonce) > constants.MaxPowNonceLen {
		utils.SendBadRequest(w)
		return
	}

	// Validate email
	if !utils.ValidateEmail(triplet.Username()) {
		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Invalid email address.",
		})
		return
	}

	// Proof of work
	if !verifyPowProof(req.PowToken, req.PowNonce, triplet.Username()) {
		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Request verification failed. Please try again.",
		})
		return
	}

	// Insert into database
	if _, err := database.Exec(r.Context(), `
		INSERT INTO users (email, salt, srp_salt, verifier, challenge)
		VALUES (?, ?, ?, ?, ?)`,
		triplet.Username(), req.Salt, triplet.Salt(), triplet.Verifier(), challenge,
	); err != nil {
		if database.IsDuplicateEntry(err) {
			utils.SendJSON(w, http.StatusConflict, types.Reply[any]{
				Success: false,
				Message: "Email already in use.",
			})
			return
		}

		utils.LogError("RegisterUser", "database.Exec", err)
		utils.SendInternalError(w)
		return
	}

	if constants.Metadata.Registration.Email.VerificationRequired {
		if err := createAndQueueVerificationToken(r.Context(), triplet.Username()); err != nil {
			utils.LogError("Register", "createAndQueueVerificationToken", err)
		}
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}

// LoginStart is the first step of the SRP login procedure.
func LoginStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
		A     []byte `json:"A"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	if len(req.Email) == 0 || len(req.Email) > constants.MaxEmailLen {
		utils.SendBadRequest(w)
		return
	}

	// If A is not provided, the client is requesting the salt
	// TODO: remove this, the client doesn't need the salt to generate A - the library is just silly
	if len(req.A) == 0 {
		var salt []byte

		if err := database.QueryRow(
			r.Context(),
			"SELECT srp_salt FROM users WHERE email = ?",
			req.Email,
		).Scan(&salt); err != nil {
			if err != sql.ErrNoRows { // no rows is ok
				utils.LogError("LoginStart", "QueryRow(srp_salt)", err)
			}

			utils.SendJSON(w, http.StatusUnauthorized, types.Reply[any]{
				Success: false,
				Message: "Invalid credentials.",
			})
			return
		}

		utils.SendJSON(w, http.StatusOK, types.Reply[[]byte]{
			Success: true,
			Data:    salt,
		})
		return
	}

	// Start of SRP flow - get salt and verifier
	var salt, verifier []byte

	user := &types.User{}
	err := database.QueryRow(r.Context(),
		"SELECT id, srp_salt, verifier FROM users WHERE email = ?",
		req.Email,
	).Scan(&user.ID, &salt, &verifier)
	if err != nil {
		if err != sql.ErrNoRows {
			utils.LogError("LoginStart", "QueryRow(verifier)", err)
		}

		utils.SendJSON(w, http.StatusUnauthorized, types.Reply[any]{
			Success: false,
			Message: "Invalid credentials.",
		})
		return
	}

	// Create SRP server (parameters must match client)
	server, err := srp.NewServer(&srp.Params{
		Name:  "DH16–SHA256–Argon2",
		Group: srp.RFC5054Group4096,
		Hash:  crypto.SHA256,
		KDF:   utils.KDFArgon2,
	}, req.Email, salt, verifier)
	if err != nil {
		utils.LogError("LoginStart", "srp.NewServer", err)
		utils.SendInternalError(w)
		return
	}

	// Set client public ephemeral A
	if err := server.SetA(req.A); err != nil {
		utils.LogError("LoginStart", "server.SetA", err)
		utils.SendBadRequest(w)
		return
	}

	// Generate a random session ID and store in session cookie
	sessionID := utils.RandomToken(32)
	if err := session.Set(w, r, "srp_session_id", sessionID); err != nil {
		utils.LogError("LoginStart", "session.Set", err)
		utils.SendInternalError(w)
		return
	}

	// Store SRP server instance in memory for step 2 verification
	srpSessionStore.Store(sessionID, types.SRPSession{
		Server:    server,
		CreatedAt: time.Now(),
		Email:     req.Email,
	})

	// Respond with salt and server public ephemeral B
	type SRPData struct {
		Salt      []byte `json:"salt"`
		B         []byte `json:"B"`
		SessionID string `json:"session_id"`
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[SRPData]{
		Success: true,
		Data: SRPData{
			Salt:      salt,
			B:         server.B(),
			SessionID: sessionID,
		},
	})
}

// LoginVerify is the second step of the SRP login procedure.
func LoginVerify(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email     string `json:"email"`
		M1        []byte `json:"M1"`
		SessionID string `json:"session_id"`
	}

	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	if len(req.Email) == 0 || len(req.M1) == 0 || len(req.SessionID) == 0 {
		utils.SendBadRequest(w)
		return
	}

	// Load the previously saved SRP server using the session ID
	value, ok := srpSessionStore.Load(req.SessionID)
	if !ok {
		utils.SendJSON(w, http.StatusUnauthorized, types.Reply[any]{
			Success: false,
			Message: "Invalid or expired session.",
		})
		return
	}

	sess := value.(types.SRPSession) // safe to assert now
	server := sess.Server            // get SRP server from the session

	// Make sure the same email is provided
	if sess.Email != req.Email {
		utils.SendJSON(w, http.StatusUnauthorized, types.Reply[any]{
			Success: false,
			Message: "Invalid session.",
		})
		return
	}

	// Verify client proof
	okVerify, err := server.CheckM1(req.M1)
	if err != nil || !okVerify {
		utils.SendJSON(w, http.StatusUnauthorized, types.Reply[any]{
			Success: false,
			Message: "Invalid credentials.",
		})
		return
	}

	var userUUID string
	var emailVerified bool
	if err := database.QueryRow(r.Context(),
		"SELECT uuid, email_verified FROM users WHERE email=?",
		sess.Email,
	).Scan(&userUUID, &emailVerified); err != nil {
		utils.LogError("LoginVerify", "database.QueryRow", err)
		utils.SendInternalError(w)
		return
	}

	// Deny login if the account's email hasn't been verified yet
	if constants.Metadata.Registration.Email.VerificationRequired && !emailVerified {
		srpSessionStore.Delete(req.SessionID)

		utils.SendJSON(w, http.StatusForbidden, types.Reply[types.EmailUnverifiedData]{
			Success: false,
			Message: "Email verification required.",
			Data: types.EmailUnverifiedData{
				Email:                sess.Email,
				RequiresVerification: true,
			},
		})
		return
	}

	// Compute server proof M2
	M2, err := server.ComputeM2()
	if err != nil {
		utils.LogError("LoginVerify", "server.ComputeM2", err)
		utils.SendInternalError(w)
		return
	}

	// Login successful, generate access token
	accessToken := utils.RandomToken(32)
	expires := time.Now().Add(constants.AccessTokenExpiry)

	// Insert new session to DB
	_, err = database.Exec(r.Context(), `
		INSERT INTO account_sessions (owner, access_token, created_at, expires_at)
		VALUES (?, ?, ?, ?)`,
		userUUID, accessToken, time.Now(), expires)
	if err != nil {
		utils.LogError("LoginVerify", "database.Exec", err)
		utils.SendInternalError(w)
		return
	}

	// Save token in session
	if err := session.Set(w, r, "access_token", accessToken); err != nil {
		utils.LogError("LoginVerify", "session.Set", err)
		utils.SendInternalError(w)
		return
	}

	// Remove SRP session after successful login
	srpSessionStore.Delete(req.SessionID)

	// Send M2 back
	type M2Data struct {
		M2 []byte `json:"M2"`
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[M2Data]{
		Success: true,
		Data: M2Data{
			M2: M2,
		},
	})
}

// Logout invalidates the current session and destroys the session cookie.
func Logout(w http.ResponseWriter, r *http.Request) {
	// Get the access token from the session
	accessToken := session.Get[string](r, "access_token")
	if accessToken != "" {
		// Delete the session from DB
		_, _ = database.Exec(r.Context(),
			"DELETE FROM account_sessions WHERE access_token = ?",
			accessToken)
	}

	// Destroy the session
	if err := session.DestroySession(w, r); err != nil {
		utils.LogError("LogoutUser", "session.DestroySession", err)
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}

// ResendVerification re-sends the existing verification email, subject to rate limits.
func ResendVerification(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email string `json:"email"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	if len(req.Email) == 0 || len(req.Email) > constants.MaxEmailLen {
		utils.SendBadRequest(w)
		return
	}

	var uuid string
	var verified bool
	if err := database.QueryRow(r.Context(),
		"SELECT uuid, email_verified FROM users WHERE email = ?",
		req.Email,
	).Scan(&uuid, &verified); err != nil {
		if err != sql.ErrNoRows {
			utils.LogError("ResendVerification", "QueryRow(users)", err)
		}

		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Your verification expired. Please sign up again.",
		})
		return
	}

	if verified {
		utils.SendJSON(w, http.StatusOK, types.Reply[any]{
			Success: true,
			Message: "Verification email sent.",
		})
		return
	}

	ctx := r.Context()
	tx, err := database.DB.BeginTx(ctx, nil)
	if err != nil {
		utils.LogError("ResendVerification", "BeginTx", err)
		utils.SendInternalError(w)
		return
	}
	defer func() { _ = tx.Rollback() }()

	var expiresAt, lastSentAt, windowStart time.Time
	var sendCount int
	err = tx.QueryRowContext(ctx,
		"SELECT expires_at, last_sent_at, send_window_start, send_count FROM email_verification_tokens WHERE owner = ? FOR UPDATE",
		uuid,
	).Scan(&expiresAt, &lastSentAt, &windowStart, &sendCount)

	now := time.Now()

	if err == sql.ErrNoRows {
		// No token on record (e.g. verification was enabled after this account registered)
		if err := queueVerificationTokenTx(ctx, tx, uuid, req.Email); err != nil {
			utils.LogError("ResendVerification", "queueVerificationTokenTx", err)
			utils.SendInternalError(w)
			return
		}

		if err := tx.Commit(); err != nil {
			utils.LogError("ResendVerification", "tx.Commit", err)
			utils.SendInternalError(w)
			return
		}

		utils.SendJSON(w, http.StatusOK, types.Reply[any]{
			Success: true,
			Message: "Verification email sent.",
		})
		return
	} else if err != nil {
		utils.LogError("ResendVerification", "QueryRow(email_verification_tokens)", err)
		utils.SendInternalError(w)
		return
	}

	if now.After(expiresAt) {
		protected, err := userHasProtectedData(ctx, uuid)
		if err != nil {
			utils.LogError("ResendVerification", "userHasProtectedData", err)
			utils.SendInternalError(w)
			return
		}

		if protected {
			if _, err := tx.ExecContext(ctx, "DELETE FROM email_verification_tokens WHERE owner = ?", uuid); err != nil {
				utils.LogError("ResendVerification", "tx.Exec(delete expired token)", err)
				utils.SendInternalError(w)
				return
			}

			if err := queueVerificationTokenTx(ctx, tx, uuid, req.Email); err != nil {
				utils.LogError("ResendVerification", "queueVerificationTokenTx", err)
				utils.SendInternalError(w)
				return
			}

			if err := tx.Commit(); err != nil {
				utils.LogError("ResendVerification", "tx.Commit", err)
				utils.SendInternalError(w)
				return
			}

			utils.SendJSON(w, http.StatusOK, types.Reply[any]{
				Success: true,
				Message: "Your verification expired. A new verification email has been sent.",
			})
			return
		}

		if _, err := tx.ExecContext(ctx, "DELETE FROM users WHERE uuid = ?", uuid); err != nil {
			utils.LogError("ResendVerification", "tx.Exec(delete user)", err)
			utils.SendInternalError(w)
			return
		}

		if err := tx.Commit(); err != nil {
			utils.LogError("ResendVerification", "tx.Commit", err)
			utils.SendInternalError(w)
			return
		}

		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Your verification expired. Please sign up again.",
		})
		return
	}

	if wait := constants.EmailVerificationResendCooldown - now.Sub(lastSentAt); wait > 0 {
		utils.SendJSON(w, http.StatusTooManyRequests, types.Reply[any]{
			Success: false,
			Message: fmt.Sprintf("Too many attempts. Try again in %d seconds.", int(wait.Seconds())+1),
		})
		return
	}

	if now.Sub(windowStart) >= time.Hour {
		windowStart = now
		sendCount = 0
	}

	if sendCount >= constants.EmailVerificationMaxSendsPerHour {
		wait := time.Until(windowStart.Add(time.Hour))
		utils.SendJSON(w, http.StatusTooManyRequests, types.Reply[any]{
			Success: false,
			Message: fmt.Sprintf("Too many attempts. Try again in %d minutes.", int(wait.Minutes())+1),
		})
		return
	}

	var token string
	if err := tx.QueryRowContext(ctx,
		"SELECT token FROM email_verification_tokens WHERE owner = ?",
		uuid,
	).Scan(&token); err != nil {
		utils.LogError("ResendVerification", "QueryRow(token)", err)
		utils.SendInternalError(w)
		return
	}

	hasQueued, err := mail.HasQueuedMails(ctx, tx, req.Email)
	if err != nil {
		utils.LogError("ResendVerification", "mail.HasQueuedMails", err)
		utils.SendInternalError(w)
		return
	}

	if !hasQueued {
		subject, body := verificationEmailContent(token)
		if err := mail.QueueMail(ctx, tx, req.Email, subject, body); err != nil {
			utils.LogError("ResendVerification", "mail.QueueMail", err)
			utils.SendInternalError(w)
			return
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE email_verification_tokens
		SET last_sent_at = ?, send_window_start = ?, send_count = ?
		WHERE owner = ?`,
		now, windowStart, sendCount+1, uuid,
	); err != nil {
		utils.LogError("ResendVerification", "tx.Exec(update)", err)
		utils.SendInternalError(w)
		return
	}

	if err := tx.Commit(); err != nil {
		utils.LogError("ResendVerification", "tx.Commit", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
		Message: "Verification email sent.",
	})
}

// VerifyEmail validates a verification token from an email link and redirects back to the client.
func VerifyEmail(w http.ResponseWriter, r *http.Request) {
	clientURL := os.Getenv("CLIENT_URL")

	fail := func() {
		http.Redirect(w, r, clientURL+"?verified=false", http.StatusFound)
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		fail()
		return
	}

	uuid, email, expiresAt, err := lookupVerificationToken(r.Context(), token)
	if err != nil {
		if err != sql.ErrNoRows {
			utils.LogError("VerifyEmail", "lookupVerificationToken", err)
		}

		fail()
		return
	}

	if time.Now().After(expiresAt) {
		if err := expireVerificationToken(r.Context(), uuid, email); err != nil {
			utils.LogError("VerifyEmail", "expireVerificationToken", err)
			utils.SendInternalError(w)
			return
		}

		fail()
		return
	}

	http.Redirect(w, r, clientURL+"?verify_token="+url.QueryEscape(token), http.StatusFound)
}

// ConfirmEmailVerification marks the account owning the given token as verified.
func ConfirmEmailVerification(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil || req.Token == "" {
		utils.SendBadRequest(w)
		return
	}

	uuid, email, expiresAt, err := lookupVerificationToken(r.Context(), req.Token)
	if err != nil {
		if err != sql.ErrNoRows {
			utils.LogError("ConfirmEmailVerification", "lookupVerificationToken", err)
		}

		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Verification link invalid or expired.",
		})
		return
	}

	if time.Now().After(expiresAt) {
		if err := expireVerificationToken(r.Context(), uuid, email); err != nil {
			utils.LogError("ConfirmEmailVerification", "expireVerificationToken", err)
			utils.SendInternalError(w)
			return
		}

		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Verification link invalid or expired.",
		})
		return
	}

	if _, err := database.Exec(r.Context(),
		"UPDATE users SET email_verified = 1 WHERE uuid = ?",
		uuid,
	); err != nil {
		utils.LogError("ConfirmEmailVerification", "database.Exec(update)", err)
		utils.SendInternalError(w)
		return
	}

	if err := mail.CancelQueuedMails(r.Context(), database.DB, email); err != nil {
		utils.LogError("ConfirmEmailVerification", "mail.CancelQueuedMails", err)
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[any]{
		Success: true,
	})
}

// lookupVerificationToken resolves a verification token to its owner, their email, and its expiry.
func lookupVerificationToken(ctx context.Context, token string) (uuid, email string, expiresAt time.Time, err error) {
	err = database.QueryRow(ctx,
		`SELECT t.owner, u.email, t.expires_at
		FROM email_verification_tokens t
		JOIN users u ON u.uuid = t.owner
		WHERE t.token = ?`,
		token,
	).Scan(&uuid, &email, &expiresAt)
	return uuid, email, expiresAt, err
}

// expireVerificationToken handles an expired token.
func expireVerificationToken(ctx context.Context, uuid, email string) error {
	protected, err := userHasProtectedData(ctx, uuid)
	if err != nil {
		return err
	}

	if protected {
		if _, err := database.Exec(ctx, "DELETE FROM email_verification_tokens WHERE owner = ?", uuid); err != nil {
			utils.LogError("expireVerificationToken", "database.Exec(delete expired token)", err)
		}
	} else if _, err := database.Exec(ctx, "DELETE FROM users WHERE uuid = ?", uuid); err != nil {
		utils.LogError("expireVerificationToken", "database.Exec(delete user)", err)
	}

	return mail.CancelQueuedMails(ctx, database.DB, email)
}
