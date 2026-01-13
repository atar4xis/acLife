// Package types defines the data structures used across the application.
package types

import (
	"time"

	"mz.attahri.com/code/srp/v3"
)

// Reply is a standard structure for JSON API responses.
type Reply[T any] struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Data    T      `json:"data,omitempty"`
}

// User represents the user data returned from the database.
type User struct {
	ID                   int     `db:"id"`
	UUID                 string  `db:"uuid"`
	Email                string  `db:"email"`
	Salt                 []byte  `db:"salt"`     // main salt used for master kdf
	SrpSalt              []byte  `db:"srp_salt"` // secondary salt used exclusively for srp flow
	Verifier             []byte  `db:"verifier"`
	Challenge            []byte  `db:"challenge"`
	StripeCustomerID     *string `db:"stripe_customer_id"`
	StripeSubscriptionID *string `db:"stripe_subscription_id"`
	SubscriptionStatus   *string `db:"subscription_status"`
}

// PublicUser contains only the exposed fields of a user.
type PublicUser struct {
	UUID               string  `json:"uuid"`
	Email              string  `json:"email"`
	SubscriptionStatus *string `json:"subscription_status"`
	// SrpSalt is exposed during SRP flow only, so it is not here
	Salt      []byte `json:"salt"`
	Challenge []byte `json:"challenge"`
}

// SRPSession holds the SRP server and a timestamp.
type SRPSession struct {
	Server    *srp.Server
	CreatedAt time.Time
	Email     string
}
