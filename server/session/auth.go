package session

import (
	"database/sql"
	"net/http"
	"time"

	"acLife/database"
	"acLife/types"
	"acLife/utils"
)

type ContextKey struct{ name string }

var UserContextKey = ContextKey{"user"}

// GetLoggedInUser retrieves the currently logged in user using the access_token stored in the session.
func GetLoggedInUser(r *http.Request, refetch ...bool) *types.User {
	doRefetch := false
	if len(refetch) > 0 {
		doRefetch = refetch[0]
	}

	// Check if user is already in context
	if !doRefetch {
		if user, ok := r.Context().Value(UserContextKey).(*types.User); ok {
			return user
		}
	}

	// Get access token from session
	token := Get[string](r, "access_token")
	if token == "" {
		return nil
	}

	// Find matching session in account_sessions
	var ownerUUID string
	var expiresAt time.Time
	if err := database.QueryRow(
		r.Context(),
		`SELECT owner, expires_at FROM account_sessions WHERE access_token = ?`,
		token,
	).Scan(&ownerUUID, &expiresAt); err != nil {
		if err != sql.ErrNoRows {
			utils.LogError("GetLoggedInUser", "QueryRow account_sessions", err)
		}
		return nil
	}

	// Check if token expired
	if time.Now().After(expiresAt) {
		return nil
	}

	// Fetch user from database
	user := &types.User{}
	if err := database.QueryRow(
		r.Context(),
		`
			SELECT 
				id, uuid, email, salt, srp_salt, verifier, challenge,
				stripe_customer_id, stripe_subscription_id, subscription_status
			FROM users
			WHERE uuid = ?`,
		ownerUUID,
	).Scan(
		&user.ID,
		&user.UUID,
		&user.Email,
		&user.Salt,
		&user.SrpSalt,
		&user.Verifier,
		&user.Challenge,
		&user.StripeCustomerID,
		&user.StripeSubscriptionID,
		&user.SubscriptionStatus,
	); err != nil {
		if err != sql.ErrNoRows {
			utils.LogError("GetLoggedInUser", "QueryRow", err)
		}

		return nil
	}

	return user
}
