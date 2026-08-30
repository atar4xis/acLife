// Package constants defines fixed values used across the application.
package constants

import (
	"log"
	"os"
	"strconv"
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

	DBMaxOpenConns    = 50
	DBMaxIdleConns    = 10
	DBConnMaxLifetime = 1 * time.Hour
	DBTimeout         = 5 * time.Second

	SMTPTimeout = 30 * time.Second

	EmailQueuePollInterval   = 10 * time.Second
	EmailQueueStaleThreshold = 1 * time.Minute
	EmailQueueMaxAttempts    = 5

	MaxEmailLen     = 260
	MaxSaltLen      = 16
	MaxVerifierLen  = 520
	MaxChallengeLen = 64
	MaxEventLen     = 10000

	BucketIDLen     = 32  // HMAC-SHA256 output size
	MaxEventBuckets = 60  // caps the number of weeks a single event may span
	MaxSyncBuckets  = 100 // caps the number of buckets requested in a single sync

	MaxBucketBackfillPerSync = 800

	EmailVerificationTTL             = 1 * Day
	EmailVerificationResendCooldown  = 60 * time.Second
	EmailVerificationMaxSendsPerHour = 4
)

// AccessTokenExpiry set in init: ACCESS_TOKEN_EXPIRY_DAYS env var if present, else default 3 days.
var AccessTokenExpiry time.Duration

var Metadata types.ServerMetadata

func init() {
	if err := godotenv.Load(); err != nil {
		log.Fatalf("Failed to load .env: %v", err)
	}

	AccessTokenExpiry = 3 * Day
	if v := os.Getenv("ACCESS_TOKEN_EXPIRY_DAYS"); v != "" {
		if days, err := strconv.Atoi(v); err == nil && days > 0 {
			AccessTokenExpiry = time.Duration(days) * Day
		} else {
			log.Printf("Invalid ACCESS_TOKEN_EXPIRY_DAYS %q, using default", v)
		}
	}

	Metadata = types.ServerMetadata{
		URL:      os.Getenv("SERVER_URL"),
		Policies: &types.Policies{},
		Registration: types.Registration{
			Enabled:              os.Getenv("DISABLE_REGISTRATION") != "true",
			SubscriptionRequired: os.Getenv("STRIPE_API_KEY") != "",
			Email: &types.EmailSettings{
				VerificationRequired: os.Getenv("DISABLE_EMAIL_VERIFICATION") != "true",
				DomainBlacklist:      []string{},
			},
			RetentionPeriod: 0,
		},
		VapidPublicKey: os.Getenv("VAPID_PUBLIC_KEY"), // for push service
	}
}
