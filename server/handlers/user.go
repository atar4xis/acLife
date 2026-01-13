package handlers

import (
	"net/http"

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
