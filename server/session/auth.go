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

	// Find the matching session and its user
	user := &types.User{}
	var expiresAt time.Time
	if err := database.QueryRow(
		r.Context(),
		`
			SELECT
				s.expires_at,
				u.id, u.uuid, u.email, u.srp_salt, u.verifier,
				u.stripe_customer_id, u.stripe_subscription_id, u.subscription_status, u.email_verified
			FROM account_sessions s
			JOIN users u ON u.uuid = s.owner
			WHERE s.access_token = ?`,
		token,
	).Scan(
		&expiresAt,
		&user.ID,
		&user.UUID,
		&user.Email,
		&user.SrpSalt,
		&user.Verifier,
		&user.StripeCustomerID,
		&user.StripeSubscriptionID,
		&user.SubscriptionStatus,
		&user.EmailVerified,
	); err != nil {
		if err != sql.ErrNoRows {
			utils.LogError("GetLoggedInUser", "QueryRow", err)
		}
		return nil
	}

	// Check if token expired
	if time.Now().After(expiresAt) {
		return nil
	}

	return user
}
