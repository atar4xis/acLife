package handlers

import (
	"crypto"
	"fmt"
	"net/http"
	"slices"
	"sync"
	"time"

	"acLife/constants"
	"acLife/types"
	"acLife/utils"

	"mz.attahri.com/code/srp/v3"
)

// loginFailures counts a proof before it is checked, so concurrent guesses cannot slip under a limit.
var loginFailures = struct {
	mu    sync.Mutex
	times map[string][]time.Time // user uuid, or user uuid|ip, -> failed proofs inside the window
	ips   map[string]*ipFailures
}{times: map[string][]time.Time{}, ips: map[string]*ipFailures{}}

// ipFailures slows one address down exponentially while it keeps failing, whatever accounts it targets.
type ipFailures struct {
	count        int
	last         time.Time
	blockedUntil time.Time
}

func accountIPKey(uuid, ip string) string { return uuid + "|" + ip }

// recentLoginFailures drops expired failures under key and returns the rest, the caller holds loginFailures.mu.
func recentLoginFailures(key string, now time.Time) []time.Time {
	var recent []time.Time
	for _, ts := range loginFailures.times[key] {
		if now.Sub(ts) < constants.LoginFailureWindow {
			recent = append(recent, ts)
		}
	}

	if len(recent) == 0 {
		delete(loginFailures.times, key)
	} else {
		loginFailures.times[key] = recent
	}
	return recent
}

// limitWait returns how long until the failures under key drop below max.
func limitWait(key string, max int, now time.Time) time.Duration {
	recent := recentLoginFailures(key, now)
	if len(recent) < max {
		return 0
	}
	return recent[len(recent)-max].Add(constants.LoginFailureWindow).Sub(now)
}

// attemptWait returns how long guesses against the account from ip stay blocked, zero when they are not, the caller holds loginFailures.mu.
func attemptWait(uuid, ip string, now time.Time) time.Duration {
	wait := max(
		limitWait(accountIPKey(uuid, ip), constants.MaxLoginFailuresPerIP, now),
		limitWait(uuid, constants.MaxLoginFailures, now),
	)
	if f := loginFailures.ips[ip]; f != nil {
		wait = max(wait, f.blockedUntil.Sub(now))
	}
	return wait
}

// lockWait returns how long guesses against the account from ip stay blocked, zero when they are not.
func lockWait(uuid, ip string) time.Duration {
	now := time.Now()
	loginFailures.mu.Lock()
	defer loginFailures.mu.Unlock()

	return attemptWait(uuid, ip, now)
}

// reserveAttempt counts a proof as failed and returns release to undo that once it proves valid, or the wait when the attempt is not allowed.
func reserveAttempt(uuid, ip string) (release func(), wait time.Duration) {
	now := time.Now()
	loginFailures.mu.Lock()
	defer loginFailures.mu.Unlock()

	if wait := attemptWait(uuid, ip, now); wait > 0 {
		return nil, wait
	}

	pairKey := accountIPKey(uuid, ip)
	loginFailures.times[pairKey] = append(loginFailures.times[pairKey], now)
	loginFailures.times[uuid] = append(loginFailures.times[uuid], now)

	f := loginFailures.ips[ip]
	if f == nil || now.Sub(f.last) > constants.IPFailureDecay {
		f = &ipFailures{}
		loginFailures.ips[ip] = f
	}
	previousBlock := f.blockedUntil
	f.count++
	f.last = now
	if over := f.count - constants.IPFailureFreeAttempts; over > 0 {
		delay := min(time.Second<<min(over-1, 30), constants.LoginFailureWindow)
		f.blockedUntil = now.Add(delay)
	}
	blockedUntil := f.blockedUntil

	return func() {
		loginFailures.mu.Lock()
		defer loginFailures.mu.Unlock()

		// the account is proven to belong to the caller, other addresses' failures stay counted
		delete(loginFailures.times, pairKey)
		loginFailures.times[uuid] = removeTime(loginFailures.times[uuid], now)
		if len(loginFailures.times[uuid]) == 0 {
			delete(loginFailures.times, uuid)
		}

		// only this attempt's own share is undone, so own-account logins never cancel failures elsewhere
		if g := loginFailures.ips[ip]; g == f {
			f.count--
			if f.blockedUntil.Equal(blockedUntil) {
				f.blockedUntil = previousBlock
			}
		}
	}, 0
}

func removeTime(times []time.Time, t time.Time) []time.Time {
	for i, ts := range times {
		if ts.Equal(t) {
			return slices.Delete(times, i, i+1)
		}
	}
	return times
}

func pruneLoginFailures(now time.Time) {
	loginFailures.mu.Lock()
	defer loginFailures.mu.Unlock()

	for key := range loginFailures.times {
		recentLoginFailures(key, now)
	}
	for ip, f := range loginFailures.ips {
		if now.Sub(f.last) > constants.IPFailureDecay {
			delete(loginFailures.ips, ip)
		}
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
func startSRP(w http.ResponseWriter, r *http.Request, fn string, sess types.SRPSession, salt, verifier, A []byte) {
	if wait := lockWait(sess.UserUUID, getClientIP(r)); wait > 0 {
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

// checkProof verifies the client proof of sess, counting a wrong one against the account and the caller's address. It replies and returns false on failure.
func checkProof(w http.ResponseWriter, r *http.Request, sess types.SRPSession, m1 []byte, status int, message, code string) bool {
	release, wait := reserveAttempt(sess.UserUUID, getClientIP(r))
	if wait > 0 {
		replyLocked(w, wait)
		return false
	}

	if verified, err := sess.Server.CheckM1(m1); err != nil || !verified {
		utils.SendJSON(w, status, types.Reply[any]{Success: false, Message: message, Code: code})
		return false
	}

	release()
	return true
}
