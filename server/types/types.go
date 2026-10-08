// Package types defines the data structures used across the application.
package types

import (
	"time"

	"mz.attahri.com/code/srp/v3"
)

// Reply is a standard structure for JSON API responses.
type Reply[T any] struct {
	Success bool           `json:"success"`
	Message string         `json:"message,omitempty"`
	Code    string         `json:"code,omitempty"`
	Params  map[string]any `json:"params,omitempty"`
	Data    T              `json:"data,omitempty"`
}

// User represents the user data returned from the database.
type User struct {
	ID                   int     `db:"id"`
	UUID                 string  `db:"uuid"`
	Email                string  `db:"email"`
	SrpSalt              []byte  `db:"srp_salt"` // secondary salt used exclusively for srp flow
	Verifier             []byte  `db:"verifier"`
	StripeCustomerID     *string `db:"stripe_customer_id"`
	StripeSubscriptionID *string `db:"stripe_subscription_id"`
	SubscriptionStatus   *string `db:"subscription_status"`
	EmailVerified        bool    `db:"email_verified"`
}

// EmailUnverifiedData signals to the client that the account exists but its email is not verified yet.
type EmailUnverifiedData struct {
	Email                string `json:"email"`
	RequiresVerification bool   `json:"requiresVerification"`
}

// KeyEnvelope is a password-wrapped data-encryption key, stored server-side as opaque ciphertext.
type KeyEnvelope struct {
	Type      string `json:"type" db:"type"`
	Version   int    `json:"version" db:"version"`
	Salt      []byte `json:"salt" db:"salt"`
	Data      []byte `json:"data" db:"data"`
	KDFParams string `json:"kdfParams" db:"kdf_params"`
}

// PublicUser contains only the exposed fields of a user.
type PublicUser struct {
	UUID               string  `json:"uuid"`
	Email              string  `json:"email"`
	SubscriptionStatus *string `json:"subscription_status"`
	// SrpSalt is exposed during SRP flow only, so it is not here
	Envelopes []KeyEnvelope `json:"envelopes"`
}

// Quota is how much of the stored-ciphertext quota a user has used, in bytes.
type Quota struct {
	Used  int64 `json:"used"`
	Limit int64 `json:"limit"`
}

// Session is a login session belonging to a user.
type Session struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	ExpiresAt time.Time `json:"expiresAt"`
	Current   bool      `json:"current"`
}

// SRPSession holds the SRP server and a timestamp. Reauth sessions prove the password of an already logged-in user.
type SRPSession struct {
	Server    *srp.Server
	CreatedAt time.Time
	Email     string
	UserUUID  string
	Reauth    bool
}

// EncryptedSettings is the user's encrypted settings blob.
type EncryptedSettings struct {
	Data    []byte `json:"data"`
	Version int    `json:"version"`
}

// SaveSettingsRequest replaces the settings blob if BaseVersion still matches the stored version.
type SaveSettingsRequest struct {
	Data        []byte `json:"data"`
	BaseVersion int    `json:"baseVersion"`
}
