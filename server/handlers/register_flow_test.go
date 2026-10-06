package handlers_test

import (
	"encoding/base64"
	"encoding/json"
	"maps"
	"net/http"
	"strings"
	"testing"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/handlers"
	"acLife/internal/testutil"
	"acLife/mail"
	"acLife/types"
)

type startData struct {
	Registered bool `json:"registered"`
}

func requireVerification(t *testing.T) {
	t.Helper()

	withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = true })
}

func newEmail() string { return testutil.RandomHex(6) + "@example.com" }

func startRegistration(t *testing.T, email string, mods map[string]any) (int, types.Reply[startData]) {
	t.Helper()

	c := testutil.NewClient(t)
	token, nonce := testutil.SolvePow(t, c, email)
	body := map[string]any{"email": email, "powToken": token, "powNonce": nonce}
	maps.Copy(body, mods)
	return testutil.Call[startData](c, "POST", "/auth/register/start", body)
}

func mailsTo(t *testing.T, email string) int {
	t.Helper()

	return count(t, "SELECT COUNT(*) FROM email_queue WHERE recipient = ?", email)
}

func pendingRows(t *testing.T, email string) int {
	t.Helper()

	return count(t, "SELECT COUNT(*) FROM pending_registrations WHERE email = ?", email)
}

func linkParams(t *testing.T, email string) map[string]string {
	t.Helper()

	var body string
	if err := database.DB.QueryRow("SELECT body FROM email_queue WHERE recipient = ? ORDER BY id DESC LIMIT 1", email).Scan(&body); err != nil {
		t.Fatal(err)
	}

	_, rest, ok := strings.Cut(body, testutil.Origin+"#token=")
	if !ok {
		t.Fatalf("no link in %q", body)
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.Fields(rest)[0])
	if err != nil {
		t.Fatal(err)
	}
	var params map[string]string
	if err := json.Unmarshal(raw, &params); err != nil {
		t.Fatal(err)
	}
	return params
}

func addPending(t *testing.T, email string, ages ...time.Duration) {
	t.Helper()

	for _, age := range ages {
		created := time.Now().Add(-age)
		if _, err := database.DB.Exec(
			"INSERT INTO pending_registrations (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
			testutil.RandomHex(32), email, created, created.Add(constants.PendingRegistrationTTL),
		); err != nil {
			t.Fatal(err)
		}
	}
}

func addSent(t *testing.T, email string, ages ...time.Duration) {
	t.Helper()

	for _, age := range ages {
		if _, err := database.DB.Exec(
			"INSERT INTO sent_mail (kind, recipient_key, created_at) VALUES (?, ?, ?)",
			mail.KindRegistration, mail.RecipientKey(email), time.Now().Add(-age),
		); err != nil {
			t.Fatal(err)
		}
	}
}

func completeRegistration(t *testing.T, c *testutil.Client, token, email string) (int, types.Reply[any]) {
	t.Helper()

	triplet, envelopes := testutil.Credentials(t, email)
	return testutil.Call[any](c, "POST", "/auth/register/complete", map[string]any{
		"token":     token,
		"triplet":   triplet,
		"envelopes": envelopes,
	})
}

func TestRegisterStartMailsALinkAndStoresOnlyTheTokenHash(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)
	email := newEmail()

	status, reply := startRegistration(t, email, nil)
	if status != http.StatusOK || reply.Data.Registered {
		t.Fatalf("got %d %+v", status, reply)
	}
	if mailsTo(t, email) != 1 || pendingRows(t, email) != 1 {
		t.Fatal("mail or pending row missing")
	}
	if count(t, "SELECT COUNT(*) FROM users WHERE email = ?", email) != 0 {
		t.Fatal("account created before the link was used")
	}

	params := linkParams(t, email)
	if params["email"] != email || len(params["token"]) != 64 || params["server"] != "http://localhost:8000" || len(params) != 3 {
		t.Fatalf("bad link %v", params)
	}
	if count(t, "SELECT COUNT(*) FROM pending_registrations WHERE token_hash = ?", params["token"]) != 0 {
		t.Fatal("token stored as is")
	}
	if count(t, "SELECT COUNT(*) FROM pending_registrations WHERE expires_at > ? AND expires_at <= ?", time.Now().Add(constants.PendingRegistrationTTL-time.Minute), time.Now().Add(constants.PendingRegistrationTTL+time.Minute)) != 1 {
		t.Fatal("token does not expire after the ttl")
	}
}

func TestRegisterStartSendsNothingForARegisteredEmail(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)
	user := testutil.NewUser(t)

	status, reply := startRegistration(t, user.Email, nil)
	if status != http.StatusOK || !reply.Data.Registered {
		t.Fatalf("got %d %+v", status, reply)
	}
	if mailsTo(t, user.Email) != 0 || pendingRows(t, user.Email) != 0 {
		t.Fatal("registered email was mailed")
	}
}

func TestRegisterStartRejectsBadRequests(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)

	t.Run("honeypot", func(t *testing.T) {
		email := newEmail()
		status, reply := startRegistration(t, email, map[string]any{"confirmEmail": "bot@example.com"})
		if status != http.StatusOK || reply.Data.Registered || mailsTo(t, email) != 0 {
			t.Fatalf("got %d %+v", status, reply)
		}
	})

	t.Run("proof of work for another email", func(t *testing.T) {
		email := newEmail()
		c := testutil.NewClient(t)
		token, nonce := testutil.SolvePow(t, c, newEmail())
		status, _ := testutil.Call[startData](c, "POST", "/auth/register/start", map[string]any{"email": email, "powToken": token, "powNonce": nonce})
		if status != http.StatusBadRequest || mailsTo(t, email) != 0 {
			t.Fatalf("got %d", status)
		}
	})

	t.Run("bad nonce", func(t *testing.T) {
		email := newEmail()
		c := testutil.NewClient(t)
		token, _ := testutil.SolvePow(t, c, email)
		status, _ := testutil.Call[startData](c, "POST", "/auth/register/start", map[string]any{"email": email, "powToken": token, "powNonce": "x"})
		if status != http.StatusBadRequest || mailsTo(t, email) != 0 {
			t.Fatalf("got %d", status)
		}
	})

	t.Run("invalid email", func(t *testing.T) {
		status, reply := testutil.Call[startData](testutil.NewClient(t), "POST", "/auth/register/start", map[string]any{"email": "not-an-email", "powToken": "x", "powNonce": "1"})
		if status != http.StatusBadRequest || reply.Code != "invalid_email" {
			t.Fatalf("got %d %+v", status, reply)
		}
	})

	t.Run("verification not required", func(t *testing.T) {
		withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = false })
		email := newEmail()
		if status, _ := startRegistration(t, email, nil); status != http.StatusBadRequest || mailsTo(t, email) != 0 {
			t.Fatalf("got %d", status)
		}
	})

	t.Run("registration disabled", func(t *testing.T) {
		withRegistration(t, func(r *types.Registration) { r.Enabled = false })
		email := newEmail()
		status, _ := testutil.Call[startData](testutil.NewClient(t), "POST", "/auth/register/start", map[string]any{"email": email, "powToken": "x", "powNonce": "1"})
		if status != http.StatusBadRequest || mailsTo(t, email) != 0 {
			t.Fatalf("got %d", status)
		}
	})
}

func TestRegisterStartLimitsTheMailsPerAddress(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)

	cases := map[string]struct {
		ages []time.Duration
		sent bool
	}{
		"none yet":                  {nil, true},
		"one inside the minute":     {[]time.Duration{30 * time.Second}, false},
		"one a minute ago":          {[]time.Duration{61 * time.Second}, true},
		"three inside the hour":     {[]time.Duration{2 * time.Minute, 20 * time.Minute, 50 * time.Minute}, false},
		"two inside the hour":       {[]time.Duration{2 * time.Minute, 20 * time.Minute}, true},
		"three, the oldest an hour": {[]time.Duration{2 * time.Minute, 20 * time.Minute, 61 * time.Minute}, true},
		"six inside the day":        {[]time.Duration{2 * time.Minute, 70 * time.Minute, 130 * time.Minute, 190 * time.Minute, 250 * time.Minute, 23 * time.Hour}, false},
		"six, the oldest a day":     {[]time.Duration{2 * time.Minute, 70 * time.Minute, 130 * time.Minute, 190 * time.Minute, 250 * time.Minute, 25 * time.Hour}, true},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			email := newEmail()
			addSent(t, email, tc.ages...)

			status, reply := startRegistration(t, email, nil)
			if status != http.StatusOK || reply.Data.Registered {
				t.Fatalf("got %d %+v", status, reply)
			}
			if sent := mailsTo(t, email) == 1; sent != tc.sent {
				t.Fatalf("mail sent = %v, want %v", sent, tc.sent)
			}
			wantPending := 0
			if tc.sent {
				wantPending = 1
			}
			if got := pendingRows(t, email); got != wantPending {
				t.Fatalf("pending rows = %d, want %d", got, wantPending)
			}
		})
	}
}

func TestRegisterStartLimitsAliasesOfOneMailbox(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)
	name := testutil.RandomHex(6)

	startRegistration(t, name+"@gmail.com", nil)
	alias := name[:3] + "." + name[3:] + "+x@gmail.com"
	status, reply := startRegistration(t, alias, nil)

	if status != http.StatusOK || reply.Data.Registered || mailsTo(t, alias) != 0 {
		t.Fatalf("got %d %+v", status, reply)
	}
}

func TestRegisterCompleteCreatesAVerifiedAccount(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)
	email := newEmail()
	startRegistration(t, email, nil)
	token := linkParams(t, email)["token"]

	if status, reply := completeRegistration(t, testutil.NewClient(t), token, email); status != http.StatusOK {
		t.Fatalf("got %d %+v", status, reply)
	}
	if count(t, "SELECT COUNT(*) FROM users WHERE email = ? AND email_verified = 1", email) != 1 {
		t.Fatal("verified account missing")
	}
	if count(t, "SELECT COUNT(*) FROM key_envelopes k JOIN users u ON u.uuid = k.owner WHERE u.email = ?", email) != 1 {
		t.Fatal("envelope missing")
	}
	if pendingRows(t, email) != 0 {
		t.Fatal("pending rows kept")
	}

	if status, _ := completeRegistration(t, testutil.NewClient(t), token, email); status != http.StatusBadRequest {
		t.Fatalf("token reused: %d", status)
	}
}

func TestRegisterCompleteLetsTheMailboxOwnerWin(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)
	email := newEmail()
	startRegistration(t, email, nil)
	owner := linkParams(t, email)["token"]
	addPending(t, email, 2*time.Minute)

	if status, _ := completeRegistration(t, testutil.NewClient(t), owner, email); status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
	if status, reply := startRegistration(t, email, nil); status != http.StatusOK || !reply.Data.Registered {
		t.Fatalf("got %d %+v", status, reply)
	}
}

func TestRegisterCompleteRejectsBadTokens(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)
	email := newEmail()
	startRegistration(t, email, nil)
	token := linkParams(t, email)["token"]

	t.Run("unknown token", func(t *testing.T) {
		status, reply := completeRegistration(t, testutil.NewClient(t), testutil.RandomHex(32), email)
		if status != http.StatusBadRequest || reply.Code != "verification_link_invalid" {
			t.Fatalf("got %d %+v", status, reply)
		}
	})

	t.Run("token of another address", func(t *testing.T) {
		if status, _ := completeRegistration(t, testutil.NewClient(t), token, newEmail()); status != http.StatusBadRequest {
			t.Fatalf("got %d", status)
		}
		if pendingRows(t, email) != 1 {
			t.Fatal("pending row consumed")
		}
	})

	t.Run("verification not required", func(t *testing.T) {
		withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = false })
		if status, _ := completeRegistration(t, testutil.NewClient(t), token, email); status != http.StatusBadRequest {
			t.Fatalf("got %d", status)
		}
	})

	t.Run("domain no longer allowed", func(t *testing.T) {
		t.Setenv("EMAIL_DOMAIN_BLACKLIST", "example.com")
		status, reply := completeRegistration(t, testutil.NewClient(t), token, email)
		if status != http.StatusBadRequest || reply.Code != "email_domain_not_allowed" {
			t.Fatalf("got %d %+v", status, reply)
		}
	})

	t.Run("expired token", func(t *testing.T) {
		if _, err := database.DB.Exec("UPDATE pending_registrations SET expires_at = ? WHERE email = ?", time.Now().Add(-time.Second), email); err != nil {
			t.Fatal(err)
		}
		if status, _ := completeRegistration(t, testutil.NewClient(t), token, email); status != http.StatusBadRequest {
			t.Fatalf("got %d", status)
		}
	})

	if count(t, "SELECT COUNT(*) FROM users") != 0 {
		t.Fatal("account created")
	}
}

func TestRegisterCompleteRefusesAnEmailTakenMeanwhile(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)
	email := newEmail()
	startRegistration(t, email, nil)
	token := linkParams(t, email)["token"]
	user := testutil.NewUser(t)
	if _, err := database.DB.Exec("UPDATE users SET email = ? WHERE uuid = ?", email, user.UUID); err != nil {
		t.Fatal(err)
	}

	if status, _ := completeRegistration(t, testutil.NewClient(t), token, email); status != http.StatusConflict {
		t.Fatalf("got %d", status)
	}
	if count(t, "SELECT COUNT(*) FROM users WHERE email = ?", email) != 1 {
		t.Fatal("account replaced")
	}
}

func TestResendVerificationMailsAPendingRegistration(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)
	email := newEmail()
	addPending(t, email, 2*time.Minute)

	resend := func() (int, types.Reply[any]) {
		return testutil.Call[any](testutil.NewClient(t), "POST", "/auth/resend-verification", map[string]any{"email": email})
	}

	if status, reply := resend(); status != http.StatusOK || reply.Code != "verification_email_sent" {
		t.Fatalf("got %d %+v", status, reply)
	}
	if mailsTo(t, email) != 1 || pendingRows(t, email) != 2 {
		t.Fatal("new link not sent")
	}

	status, reply := resend()
	if status != http.StatusTooManyRequests || reply.Code != "too_many_attempts_seconds" {
		t.Fatalf("got %d %+v", status, reply)
	}
	if mailsTo(t, email) != 1 {
		t.Fatal("mail sent while limited")
	}
}

func TestResendVerificationIgnoresAddressesWithoutAPendingRegistration(t *testing.T) {
	testutil.RequireDB(t)
	requireVerification(t)
	email := newEmail()

	status, reply := testutil.Call[any](testutil.NewClient(t), "POST", "/auth/resend-verification", map[string]any{"email": email})
	if status != http.StatusBadRequest || reply.Code != "verification_expired_sign_up" {
		t.Fatalf("got %d %+v", status, reply)
	}

	addPending(t, email, 2*time.Minute)
	if _, err := database.DB.Exec("UPDATE pending_registrations SET expires_at = ?", time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	status, _ = testutil.Call[any](testutil.NewClient(t), "POST", "/auth/resend-verification", map[string]any{"email": email})
	if status != http.StatusBadRequest || mailsTo(t, email) != 0 {
		t.Fatalf("got %d", status)
	}
}

func TestStalePendingRegistrationsAreDeleted(t *testing.T) {
	testutil.RequireDB(t)
	email := newEmail()
	addPending(t, email, time.Hour, constants.PendingRegistrationTTL+time.Minute)

	if err := handlers.DeleteStalePendingRegistrations(t.Context(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if got := pendingRows(t, email); got != 1 {
		t.Fatalf("rows left: %d", got)
	}
}
