// Package testutil provides the shared environment, database and HTTP helpers for server tests.
package testutil

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/routes"
	"acLife/session"
	"acLife/types"

	"github.com/gorilla/securecookie"
)

// Origin is the allowed client origin configured for tests.
const Origin = "http://localhost:5173"

var dbReady bool

// Main configures the environment, creates a throwaway database, runs the tests and drops the database.
// The database is only created when TEST_DB_USER is set, tests that need it skip otherwise.
func Main(m *testing.M) int {
	for _, k := range []string{"STRIPE_API_KEY", "STRIPE_WEBHOOK_SECRET", "IS_BEHIND_PROXY", "ENV", "EMAIL_DOMAIN_BLACKLIST", "EMAIL_DOMAIN_WHITELIST", "DISABLE_REGISTRATION"} {
		_ = os.Unsetenv(k)
	}
	_ = os.Setenv("SESSION_KEY", "test-session-key-0123456789abcdefghij")
	_ = os.Setenv("SERVER_URL", "http://localhost:8000/")
	_ = os.Setenv("CLIENT_URL", Origin)
	_ = os.Setenv("CORS_ALLOWED_ORIGINS", Origin)
	_ = os.Setenv("DISABLE_EMAIL_VERIFICATION", "true")

	constants.Configure()
	session.Store = session.NewStore([]byte(os.Getenv("SESSION_KEY")), "")

	if os.Getenv("TEST_DB_USER") == "" {
		return m.Run()
	}

	cleanup, err := setupDB()
	if err != nil {
		fmt.Fprintf(os.Stderr, "test database setup failed: %v\n", err)
		return 1
	}
	dbReady = true

	code := m.Run()
	cleanup()
	return code
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func setupDB() (func(), error) {
	user := os.Getenv("TEST_DB_USER")
	password := os.Getenv("TEST_DB_PASSWORD")
	host := envOr("TEST_DB_HOST", "127.0.0.1")
	port := envOr("TEST_DB_PORT", "3306")
	name := "aclife_test_" + RandomHex(6)

	admin, err := sql.Open("mysql", fmt.Sprintf("%s:%s@tcp(%s:%s)/", user, password, host, port))
	if err != nil {
		return nil, err
	}
	if _, err := admin.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4"); err != nil {
		_ = admin.Close()
		return nil, err
	}

	_ = os.Setenv("DB_USER", user)
	_ = os.Setenv("DB_PASSWORD", password)
	_ = os.Setenv("DB_HOST", host)
	_ = os.Setenv("DB_PORT", port)
	_ = os.Setenv("DB_NAME", name)

	cleanup := func() {
		if database.DB != nil {
			_ = database.DB.Close()
		}
		_, _ = admin.Exec("DROP DATABASE `" + name + "`")
		_ = admin.Close()
	}

	if err := database.Connect(); err != nil {
		cleanup()
		return nil, err
	}
	if err := database.Setup(); err != nil {
		cleanup()
		return nil, err
	}

	return cleanup, nil
}

// RequireDB skips the test when no test database is configured, otherwise empties every table.
func RequireDB(t *testing.T) {
	t.Helper()
	if !dbReady {
		t.Skip("TEST_DB_USER not set")
	}
	for _, q := range []string{"DELETE FROM users", "DELETE FROM email_queue"} {
		if _, err := database.DB.Exec(q); err != nil {
			t.Fatalf("reset: %v", err)
		}
	}
}

// RandomHex returns 2n random hex characters.
func RandomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// NewUUID returns a random lowercase v4 uuid.
func NewUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

// UUIDToBase64 converts a uuid to the base64 form clients send in sync requests.
func UUIDToBase64(id string) string {
	raw, err := hex.DecodeString(id[0:8] + id[9:13] + id[14:18] + id[19:23] + id[24:])
	if err != nil {
		panic(err)
	}
	return base64.StdEncoding.EncodeToString(raw)
}

// BucketID returns a valid base64 bucket id derived from n.
func BucketID(n byte) string {
	return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{n}, constants.BucketIDLen))
}

/* -------------------- Fixtures -------------------- */

// User is a user row inserted by NewUser.
type User struct {
	UUID           string
	Email          string
	SubscriptionID string
}

type userConfig struct {
	unverified bool
	subStatus  string
}

// UserOption customizes NewUser.
type UserOption func(*userConfig)

// Unverified leaves the user's email unverified.
func Unverified() UserOption { return func(c *userConfig) { c.unverified = true } }

// Subscribed gives the user a Stripe subscription with the given status.
func Subscribed(status string) UserOption { return func(c *userConfig) { c.subStatus = status } }

// NewUser inserts a verified user with placeholder credentials.
func NewUser(t *testing.T, opts ...UserOption) User {
	t.Helper()

	var cfg userConfig
	for _, o := range opts {
		o(&cfg)
	}

	u := User{UUID: NewUUID(), Email: RandomHex(6) + "@example.com"}

	var subID, subStatus any
	if cfg.subStatus != "" {
		u.SubscriptionID = "sub_" + RandomHex(6)
		subID, subStatus = u.SubscriptionID, cfg.subStatus
	}

	if _, err := database.DB.Exec(
		`INSERT INTO users (uuid, email, srp_salt, verifier, stripe_subscription_id, subscription_status, email_verified)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		u.UUID, u.Email, srpSalt, verifierFor(t, u.Email), subID, subStatus, !cfg.unverified,
	); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	return u
}

// NewSession inserts an account session for u and returns the signed session cookie.
func NewSession(t *testing.T, u User, expiresAt time.Time) *http.Cookie {
	t.Helper()

	token := RandomHex(16)
	if _, err := database.DB.Exec(
		"INSERT INTO account_sessions (owner, access_token, expires_at) VALUES (?, ?, ?)",
		u.UUID, token, expiresAt,
	); err != nil {
		t.Fatalf("insert session: %v", err)
	}

	return &http.Cookie{Name: constants.SessionName, Value: signSession(t, token)}
}

// ForgedSession returns a validly signed cookie whose token has no account_sessions row.
func ForgedSession(t *testing.T) *http.Cookie {
	t.Helper()
	return &http.Cookie{Name: constants.SessionName, Value: signSession(t, RandomHex(16))}
}

func signSession(t *testing.T, token string) string {
	t.Helper()

	value, err := securecookie.EncodeMulti(
		constants.SessionName,
		map[any]any{"access_token": token},
		session.Store.Codecs...,
	)
	if err != nil {
		t.Fatalf("encode session: %v", err)
	}
	return value
}

/* -------------------- HTTP -------------------- */

// Client talks to a running instance of the real router.
type Client struct {
	t      *testing.T
	URL    string
	cookie *http.Cookie
}

// NewClient starts the real router on a local test server.
func NewClient(t *testing.T) *Client {
	t.Helper()

	srv := httptest.NewServer(routes.New())
	t.Cleanup(srv.Close)

	return &Client{t: t, URL: srv.URL}
}

// WithCookie returns a copy of c that sends the given session cookie.
func (c *Client) WithCookie(cookie *http.Cookie) *Client {
	cp := *c
	cp.cookie = cookie
	return &cp
}

// As returns a copy of c logged in as u with a session valid for an hour.
func (c *Client) As(u User) *Client {
	return c.WithCookie(NewSession(c.t, u, time.Now().Add(time.Hour)))
}

// Do sends a request with the allowed Origin, body is JSON-encoded unless it is a []byte or nil.
func (c *Client) Do(method, path string, body any, mods ...func(*http.Request)) (*http.Response, []byte) {
	c.t.Helper()

	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case []byte:
		reader = bytes.NewReader(b)
	default:
		raw, err := json.Marshal(b)
		if err != nil {
			c.t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}

	req, err := http.NewRequest(method, c.URL+path, reader)
	if err != nil {
		c.t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Origin", Origin)
	if c.cookie != nil {
		req.AddCookie(c.cookie)
	}
	for _, mod := range mods {
		mod(req)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		c.t.Fatalf("read body: %v", err)
	}
	return resp, raw
}

// Open sends a GET with the allowed Origin and returns the response without reading its body.
func (c *Client) Open(ctx context.Context, path string) *http.Response {
	c.t.Helper()

	req, err := http.NewRequestWithContext(ctx, "GET", c.URL+path, nil)
	if err != nil {
		c.t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Origin", Origin)
	if c.cookie != nil {
		req.AddCookie(c.cookie)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("GET %s: %v", path, err)
	}
	return resp
}

// Call sends a request and decodes the standard JSON reply.
func Call[T any](c *Client, method, path string, body any, mods ...func(*http.Request)) (int, types.Reply[T]) {
	c.t.Helper()

	resp, raw := c.Do(method, path, body, mods...)

	var reply types.Reply[T]
	if err := json.Unmarshal(raw, &reply); err != nil {
		c.t.Fatalf("%s %s: decode %q: %v", method, path, raw, err)
	}
	return resp.StatusCode, reply
}
