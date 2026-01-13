package handlers

import (
	"crypto"
	"database/sql"
	"net/http"
	"sync"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/session"
	"acLife/types"
	"acLife/utils"

	"mz.attahri.com/code/srp/v3"
)

var srpSessionStore = sync.Map{} // map[string]types.SRPSession

func init() {
	go cleanupSRPSessions()
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

/* -------------------- Handlers -------------------- */

// Register handles creating new accounts.
func Register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Challenge string `json:"challenge"`
		Triplet   []byte `json:"triplet"`
		Salt      []byte `json:"salt"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	var triplet srp.Triplet = req.Triplet
	challenge := req.Challenge

	// Make sure the fields are not empty
	if len(triplet.Username()) == 0 || len(triplet.Verifier()) == 0 || len(triplet.Salt()) == 0 || len(challenge) == 0 {
		utils.SendBadRequest(w)
		return
	}

	// Enforce max lengths
	if len(triplet.Username()) > constants.MaxEmailLen ||
		len(triplet.Salt()) > constants.MaxSaltLen ||
		len(req.Salt) > constants.MaxSaltLen ||
		len(triplet.Verifier()) > constants.MaxVerifierLen ||
		len(challenge) > constants.MaxChallengeLen {
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

	// Compute server proof M2
	M2, err := server.ComputeM2()
	if err != nil {
		utils.LogError("LoginVerify", "server.ComputeM2", err)
		utils.SendInternalError(w)
		return
	}

	// Login successful, generate access token
	accessToken := utils.RandomToken(32)
	expires := time.Now().Add(12 * time.Hour)

	// Get the user UUID for this email
	var userUUID string
	if err := database.QueryRow(r.Context(),
		"SELECT uuid FROM users WHERE email=?",
		sess.Email,
	).Scan(&userUUID); err != nil {
		utils.LogError("LoginVerify", "database.QueryRow", err)
		utils.SendInternalError(w)
		return
	}

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
