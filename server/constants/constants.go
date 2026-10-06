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

	HTTPTimeout       = 10 * time.Second
	ReadHeaderTimeout = 10 * time.Second
	IdleTimeout       = 2 * time.Minute
	RequestDeadline   = 20 * time.Second

	StreamHeartbeat       = 20 * time.Second
	StreamBuffer          = 16
	MaxStreamsPerUser     = 30
	MaxStreamPayloadBytes = 64 << 10

	SRPSessionTTL         = 5 * time.Minute
	MaxLoginFailures      = 50
	MaxLoginFailuresPerIP = 5
	LoginFailureWindow    = 15 * time.Minute
	IPFailureFreeAttempts = 5             // failures from one address before its delay starts
	IPFailureDecay        = 1 * time.Hour // a quiet address starts over after this
	RateLimitCacheTTL     = 2 * time.Minute

	DBMaxOpenConns    = 50
	DBMaxIdleConns    = 10
	DBConnMaxLifetime = 1 * time.Hour
	DBTimeout         = 5 * time.Second

	SMTPTimeout = 30 * time.Second

	StripePricingCacheTTL = 5 * time.Minute
	// used when PUSH_ALLOWED_ENDPOINTS is empty
	DefaultPushAllowedEndpoints = "*.push.services.mozilla.com,*.googleapis.com,*.windows.com,*.notify.windows.com,*.push.apple.com"

	EmailQueuePollInterval   = 10 * time.Second
	EmailQueueStaleThreshold = 1 * time.Minute
	EmailQueueMaxAttempts    = 5

	MaxEmailLen    = 260
	MaxSaltLen     = 16
	MaxVerifierLen = 520
	MaxEventLen    = 10000
	MaxPowTokenLen = 512
	MaxPowNonceLen = 32

	MaxEnvelopeSaltLen = 64
	MaxEnvelopeDataLen = 256
	MaxKDFParamsLen    = 255
	MaxEnvelopeCount   = 1

	PowChallengeTTL   = 2 * time.Minute
	PowDifficultyBits = 17 // ~1-5s of client-side hashing

	BucketIDLen     = 32  // HMAC-SHA256 output size
	MaxEventBuckets = 60  // caps the number of weeks a single event may span
	MaxSyncBuckets  = 100 // caps the number of buckets requested in a single sync

	MaxSettingsBytes = 128 << 10 // caps the encrypted settings blob

	// MySQL TIMESTAMP range + 1 day
	MinEventTimestampMs = int64(Day / time.Millisecond)
	MaxEventTimestampMs = 2147483647000 - MinEventTimestampMs

	EmailVerificationTTL             = 1 * Day
	EmailVerificationResendCooldown  = 60 * time.Second
	EmailVerificationMaxSendsPerHour = 4
	PendingRegistrationTTL           = 24 * time.Hour
	RegistrationMailsPerMinute       = 1
	RegistrationMailsPerHour         = 3
	RegistrationMailsPerDay          = 6
)

var (
	MaxUserEvents    int
	MaxUserBytes     int64
	MaxSaveBodyBytes int64
	MaxSyncBodyBytes int64
)

// AccessTokenExpiry set in init: ACCESS_TOKEN_EXPIRY_DAYS env var if present, else default 3 days.
var AccessTokenExpiry time.Duration

var Metadata types.ServerMetadata

// Load reads .env (fatal if missing) and configures the package from the environment.
func Load() {
	if err := godotenv.Load(); err != nil {
		log.Fatalf("Failed to load .env: %v", err)
	}

	Configure()
}

// Configure derives AccessTokenExpiry and Metadata from the current environment.
func Configure() {
	AccessTokenExpiry = 3 * Day
	if v := os.Getenv("ACCESS_TOKEN_EXPIRY_DAYS"); v != "" {
		if days, err := strconv.Atoi(v); err == nil && days > 0 {
			AccessTokenExpiry = time.Duration(days) * Day
		} else {
			log.Printf("Invalid ACCESS_TOKEN_EXPIRY_DAYS %q, using default", v)
		}
	}

	MaxUserEvents = int(envInt("MAX_USER_EVENTS", 50000))
	MaxUserBytes = envInt("MAX_USER_BYTES", 500<<20)
	MaxSaveBodyBytes = envInt("MAX_SAVE_BODY_BYTES", 16<<20)
	MaxSyncBodyBytes = int64(MaxUserEvents)*80 + 64<<10 // about 80 bytes per cached event entry

	Metadata = types.ServerMetadata{
		URL: os.Getenv("SERVER_URL"),
		Policies: &types.Policies{
			Privacy: os.Getenv("PRIVACY_URL"),
			Terms:   os.Getenv("TERMS_URL"),
		},
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

// envInt reads a positive integer from the environment, falling back to def when unset or invalid.
func envInt(name string, def int64) int64 {
	v := os.Getenv(name)
	if v == "" {
		return def
	}

	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n <= 0 {
		log.Printf("Invalid %s %q, using default", name, v)
		return def
	}
	return n
}
