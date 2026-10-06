package handlers

import (
	"crypto"
	"fmt"
	"net/http"
	"sync"
	"time"

	"acLife/constants"
	"acLife/types"
	"acLife/utils"

	"mz.attahri.com/code/srp/v3"
)

var loginFailures = struct {
	mu    sync.Mutex
	times map[string][]time.Time // user uuid -> failed proofs inside the window
}{times: map[string][]time.Time{}}

// recentLoginFailures drops expired failures of uuid and returns the rest, the caller holds loginFailures.mu.
func recentLoginFailures(uuid string, now time.Time) []time.Time {
	var recent []time.Time
	for _, ts := range loginFailures.times[uuid] {
		if now.Sub(ts) < constants.LoginFailureWindow {
			recent = append(recent, ts)
		}
	}

	if len(recent) == 0 {
		delete(loginFailures.times, uuid)
	} else {
		loginFailures.times[uuid] = recent
	}
	return recent
}

// lockWait returns how long guesses against the account stay blocked, zero when they are not.
func lockWait(uuid string) time.Duration {
	now := time.Now()
	loginFailures.mu.Lock()
	defer loginFailures.mu.Unlock()

	recent := recentLoginFailures(uuid, now)
	if len(recent) < constants.MaxLoginFailures {
		return 0
	}
	return recent[len(recent)-constants.MaxLoginFailures].Add(constants.LoginFailureWindow).Sub(now)
}

func recordLoginFailure(uuid string) {
	now := time.Now()
	loginFailures.mu.Lock()
	defer loginFailures.mu.Unlock()

	loginFailures.times[uuid] = append(recentLoginFailures(uuid, now), now)
}

func clearLoginFailures(uuid string) {
	loginFailures.mu.Lock()
	defer loginFailures.mu.Unlock()

	delete(loginFailures.times, uuid)
}

func pruneLoginFailures(now time.Time) {
	loginFailures.mu.Lock()
	defer loginFailures.mu.Unlock()

	for uuid := range loginFailures.times {
		recentLoginFailures(uuid, now)
	}
}

func replyLocked(w http.ResponseWriter, wait time.Duration) {
	minutes := int(wait.Minutes()) + 1
	utils.SendJSON(w, http.StatusTooManyRequests, types.Reply[any]{
		Success: false,
		Message: fmt.Sprintf("Too many attempts. Try again in %d minutes.", minutes),
		Code:    "too_many_attempts_minutes",
		Params:  map[string]any{"count": minutes},
	})
}

// srpStart is what both start endpoints answer with.
type srpStart struct {
	B         []byte `json:"B"`
	SessionID string `json:"session_id"`
}

// startSRP opens an SRP session for the account of sess (Email, UserUUID and Reauth set) and replies with B, or with the error.
func startSRP(w http.ResponseWriter, fn string, sess types.SRPSession, salt, verifier, A []byte) {
	if wait := lockWait(sess.UserUUID); wait > 0 {
		replyLocked(w, wait)
		return
	}

	// parameters must match the client
	server, err := srp.NewServer(&srp.Params{
		Name:  "DH16–SHA256–Argon2",
		Group: srp.RFC5054Group4096,
		Hash:  crypto.SHA256,
		KDF:   utils.KDFArgon2,
	}, sess.Email, salt, verifier)
	if err != nil {
		utils.LogError(fn, "srp.NewServer", err)
		utils.SendInternalError(w)
		return
	}

	if err := server.SetA(A); err != nil {
		utils.LogError(fn, "server.SetA", err)
		utils.SendBadRequest(w)
		return
	}

	sess.Server = server
	sess.CreatedAt = time.Now()
	sessionID := utils.RandomToken(32)
	srpSessionStore.Store(sessionID, sess)

	utils.SendJSON(w, http.StatusOK, types.Reply[srpStart]{
		Success: true,
		Data:    srpStart{B: server.B(), SessionID: sessionID},
	})
}

// takeSRPSession returns the live session of the given kind, it can be used only once.
func takeSRPSession(sessionID string, reauth bool) (types.SRPSession, bool) {
	value, ok := srpSessionStore.LoadAndDelete(sessionID)
	if !ok {
		return types.SRPSession{}, false
	}

	sess := value.(types.SRPSession)
	return sess, sess.Reauth == reauth && time.Since(sess.CreatedAt) <= constants.SRPSessionTTL
}

// checkProof verifies the client proof of sess, counting a wrong one against the account. It replies and returns false on failure.
func checkProof(w http.ResponseWriter, sess types.SRPSession, m1 []byte, status int, message, code string) bool {
	if wait := lockWait(sess.UserUUID); wait > 0 {
		replyLocked(w, wait)
		return false
	}

	if verified, err := sess.Server.CheckM1(m1); err != nil || !verified {
		recordLoginFailure(sess.UserUUID)
		utils.SendJSON(w, status, types.Reply[any]{Success: false, Message: message, Code: code})
		return false
	}

	clearLoginFailures(sess.UserUUID)
	return true
}
