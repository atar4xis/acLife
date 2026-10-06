package handlers

import (
	"net/http"

	"acLife/session"
	"acLife/types"
	"acLife/utils"
)

// ReauthStart opens an SRP session for the logged-in user, to be redeemed by a request that needs the password.
func ReauthStart(w http.ResponseWriter, r *http.Request) {
	user := session.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	var req struct {
		A []byte `json:"A"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil || len(req.A) == 0 {
		utils.SendBadRequest(w)
		return
	}

	startSRP(w, "ReauthStart", types.SRPSession{Email: user.Email, UserUUID: user.UUID, Reauth: true}, user.SrpSalt, user.Verifier, req.A)
}

// reauthProof is embedded in the request of every endpoint that needs the current password.
type reauthProof struct {
	SessionID string `json:"session_id"`
	M1        []byte `json:"M1"`
}

// requirePassword checks the proof against the session ReauthStart opened, replying and returning false when it fails.
func requirePassword(w http.ResponseWriter, user *types.User, proof reauthProof) bool {
	sess, ok := takeSRPSession(proof.SessionID, true)
	if !ok || sess.UserUUID != user.UUID {
		utils.SendJSON(w, http.StatusBadRequest, types.Reply[any]{
			Success: false,
			Message: "Invalid or expired session.",
			Code:    "session_expired",
		})
		return false
	}

	return checkProof(w, sess, proof.M1, http.StatusBadRequest, "Current password is incorrect.", "current_password_incorrect")
}
