// Package constants defines fixed values used across the application.
package constants

import (
	"log"
	"os"
	"time"

	"acLife/types"

	"github.com/joho/godotenv"
)

const Day = 24 * time.Hour

const (
	Version = "0.0.1"

	SessionName = "acl_session"

	HTTPTimeout = 10 * time.Second

	SRPSessionTTL     = 5 * time.Minute
	SubCacheTTL       = 5 * time.Minute
	RateLimitCacheTTL = 2 * time.Minute

	AccessTokenExpiry = 7 * Day

	DBMaxOpenConns    = 50
	DBMaxIdleConns    = 10
	DBConnMaxLifetime = 1 * time.Hour
	DBTimeout         = 5 * time.Second

	MaxEmailLen     = 260
	MaxSaltLen      = 16
	MaxVerifierLen  = 520
	MaxChallengeLen = 64
)

var Metadata types.ServerMetadata

func init() {
	if err := godotenv.Load(); err != nil {
		log.Fatalf("Failed to load .env: %v", err)
	}

	Metadata = types.ServerMetadata{
		URL:      os.Getenv("SERVER_URL"),
		Policies: &types.Policies{},
		Registration: types.Registration{
			Enabled:              true,
			SubscriptionRequired: true,
			Email: &types.EmailSettings{
				VerificationRequired: false,
				DomainBlacklist:      []string{},
			},
			RetentionPeriod: 0,
		},
		VapidPublicKey: os.Getenv("VAPID_PUBLIC_KEY"), // for push service
	}
}
