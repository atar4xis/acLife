package handlers_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"acLife/database"
	"acLife/handlers"
	"acLife/internal/testutil"
	"acLife/types"
)

func withoutOrigin(r *http.Request) { r.Header.Del("Origin") }

func withOrigin(origin string) func(*http.Request) {
	return func(r *http.Request) { r.Header.Set("Origin", origin) }
}

func TestAuth(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t)
	user := testutil.NewUser(t)

	t.Run("valid session", func(t *testing.T) {
		status, reply := testutil.Call[types.PublicUser](c.As(user), "GET", "/user", nil)
		if status != http.StatusOK || reply.Data.UUID != user.UUID || reply.Data.Email != user.Email {
			t.Fatalf("got %d %+v", status, reply)
		}
	})

	cases := []struct {
		name   string
		client *testutil.Client
	}{
		{"no cookie", c},
		{"signed token without session row", c.WithCookie(testutil.ForgedSession(t))},
		{"expired session", c.WithCookie(testutil.NewSession(t, user, time.Now().Add(-time.Minute)))},
		{"tampered cookie", c.WithCookie(&http.Cookie{Name: "acl_session", Value: "garbage"})},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, reply := testutil.Call[any](tc.client, "GET", "/user", nil)
			if status != http.StatusUnauthorized || reply.Code != "not_logged_in" {
				t.Fatalf("got %d %+v", status, reply)
			}
		})
	}
}

func TestAuthRejectsUnknownUserSessionAfterUserDeleted(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t)
	user := testutil.NewUser(t)
	cookie := testutil.NewSession(t, user, time.Now().Add(time.Hour))

	if _, err := database.DB.Exec("DELETE FROM users WHERE uuid = ?", user.UUID); err != nil {
		t.Fatal(err)
	}

	status, _ := testutil.Call[any](c.WithCookie(cookie), "GET", "/user", nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("got %d", status)
	}
}

func TestAuthLogsOutUnverifiedUserWhenVerificationRequired(t *testing.T) {
	testutil.RequireDB(t)
	withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = true })
	c := testutil.NewClient(t)
	user := testutil.NewUser(t, testutil.Unverified())
	client := c.As(user)

	status, reply := testutil.Call[types.EmailUnverifiedData](client, "GET", "/user", nil)
	if status != http.StatusForbidden || reply.Code != "email_verification_required" {
		t.Fatalf("got %d %+v", status, reply)
	}
	if !reply.Data.RequiresVerification || reply.Data.Email != user.Email {
		t.Fatalf("unexpected data %+v", reply.Data)
	}
	if n := count(t, "SELECT COUNT(*) FROM account_sessions WHERE owner = ?", user.UUID); n != 0 {
		t.Fatalf("session rows left: %d", n)
	}
}

func TestAuthAllowsUnverifiedUserWhenVerificationDisabled(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t)
	user := testutil.NewUser(t, testutil.Unverified())

	status, _ := testutil.Call[any](c.As(user), "GET", "/user", nil)
	if status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
}

func TestAuthAllowsVerifiedUserWhenVerificationRequired(t *testing.T) {
	testutil.RequireDB(t)
	withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = true })
	c := testutil.NewClient(t)

	status, _ := testutil.Call[any](c.As(testutil.NewUser(t)), "GET", "/user", nil)
	if status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
}

func TestCSRF(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t)
	client := c.As(testutil.NewUser(t))

	cases := []struct {
		name   string
		method string
		path   string
		mod    func(*http.Request)
		status int
		code   string
	}{
		{"post without origin", "POST", "/calendar/events/save", withoutOrigin, http.StatusForbidden, "missing_origin"},
		{"post with foreign origin", "POST", "/calendar/events/save", withOrigin("https://evil.example"), http.StatusForbidden, "invalid_origin"},
		{"post with origin as substring", "POST", "/calendar/events/save", withOrigin(testutil.Origin + ".evil.example"), http.StatusForbidden, "invalid_origin"},
		{"delete with foreign origin", "DELETE", "/user/sessions/x", withOrigin("https://evil.example"), http.StatusForbidden, "invalid_origin"},
		{"post with allowed origin", "POST", "/calendar/events/save", withOrigin(testutil.Origin), http.StatusOK, ""},
		{"get without origin", "GET", "/user/sessions", withoutOrigin, http.StatusOK, ""},
		{"get with foreign origin", "GET", "/user/sessions", withOrigin("https://evil.example"), http.StatusOK, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var body any
			if tc.method == "POST" {
				body = []any{}
			}
			status, reply := testutil.Call[any](client, tc.method, tc.path, body, tc.mod)
			if status != tc.status || reply.Code != tc.code {
				t.Fatalf("got %d %+v", status, reply)
			}
		})
	}
}

func TestCSRFRunsBeforeAuth(t *testing.T) {
	c := testutil.NewClient(t)

	status, reply := testutil.Call[any](c, "POST", "/calendar/events/save", []any{}, withoutOrigin)
	if status != http.StatusForbidden || reply.Code != "missing_origin" {
		t.Fatalf("got %d %+v", status, reply)
	}
}

func TestStripeWebhookIsExemptFromCSRF(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
	c := testutil.NewClient(t)

	resp, _ := c.Do("POST", "/stripe/webhook", []byte("{}"), withOrigin("https://evil.example"))
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("got %d", resp.StatusCode)
	}
}

func TestSubscriptionGate(t *testing.T) {
	testutil.RequireDB(t)

	t.Run("not required lets unsubscribed user through", func(t *testing.T) {
		c := testutil.NewClient(t)
		status, _ := testutil.Call[any](c.As(testutil.NewUser(t)), "GET", "/user/settings", nil)
		if status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
	})

	t.Run("required", func(t *testing.T) {
		requireSubscription(t)

		cases := []struct {
			name   string
			status string
			want   int
		}{
			{"active", "active", http.StatusOK},
			{"trialing", "trialing", http.StatusOK},
			{"past due", "past_due", http.StatusPaymentRequired},
			{"canceled", "canceled", http.StatusPaymentRequired},
			{"incomplete", "incomplete", http.StatusPaymentRequired},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				c := testutil.NewClient(t)
				user := testutil.NewUser(t, testutil.Subscribed(tc.status))

				status, reply := testutil.Call[any](c.As(user), "GET", "/user/settings", nil)
				if status != tc.want {
					t.Fatalf("got %d %+v", status, reply)
				}
				if tc.want == http.StatusPaymentRequired && reply.Code != "invalid_subscription" {
					t.Fatalf("got code %q", reply.Code)
				}
			})
		}

		t.Run("no subscription", func(t *testing.T) {
			c := testutil.NewClient(t)
			status, reply := testutil.Call[any](c.As(testutil.NewUser(t)), "GET", "/user/settings", nil)
			if status != http.StatusPaymentRequired || reply.Code != "invalid_subscription" {
				t.Fatalf("got %d %+v", status, reply)
			}
		})

		t.Run("applies to calendar routes", func(t *testing.T) {
			c := testutil.NewClient(t)
			status, _ := testutil.Call[any](c.As(testutil.NewUser(t)), "POST", "/calendar/events/save", []any{})
			if status != http.StatusPaymentRequired {
				t.Fatalf("got %d", status)
			}
		})

		t.Run("does not apply to account routes", func(t *testing.T) {
			c := testutil.NewClient(t)
			status, _ := testutil.Call[any](c.As(testutil.NewUser(t)), "GET", "/user", nil)
			if status != http.StatusOK {
				t.Fatalf("got %d", status)
			}
		})
	})
}

func TestRateLimit(t *testing.T) {
	testutil.RequireDB(t)

	hit := func(client *testutil.Client, mods ...func(*http.Request)) int {
		status, _ := testutil.Call[any](client, "GET", "/user/sessions", nil, mods...)
		return status
	}
	exhaust := func(client *testutil.Client, mods ...func(*http.Request)) {
		for i := range 5 {
			if status := hit(client, mods...); status != http.StatusOK {
				t.Fatalf("request %d: got %d", i+1, status)
			}
		}
	}

	t.Run("blocks the request over the limit", func(t *testing.T) {
		client := testutil.NewClient(t).As(testutil.NewUser(t))
		exhaust(client)

		status, reply := testutil.Call[any](client, "GET", "/user/sessions", nil)
		if status != http.StatusTooManyRequests || reply.Code != "too_many_requests" {
			t.Fatalf("got %d %+v", status, reply)
		}
	})

	t.Run("allows requests again after the window", func(t *testing.T) {
		client := testutil.NewClient(t).As(testutil.NewUser(t))
		exhaust(client)

		time.Sleep(1100 * time.Millisecond)
		if status := hit(client); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
	})

	realIP := func(ip string) func(*http.Request) {
		return func(r *http.Request) { r.Header.Set("X-Real-IP", ip) }
	}

	t.Run("separates clients by X-Real-IP behind a proxy", func(t *testing.T) {
		t.Setenv("IS_BEHIND_PROXY", "1")
		client := testutil.NewClient(t).As(testutil.NewUser(t))
		exhaust(client, realIP("203.0.113.1"))

		if status := hit(client, realIP("203.0.113.1")); status != http.StatusTooManyRequests {
			t.Fatalf("same ip: got %d", status)
		}
		if status := hit(client, realIP("203.0.113.2")); status != http.StatusOK {
			t.Fatalf("other ip: got %d", status)
		}
	})

	t.Run("ignores X-Real-IP without a proxy", func(t *testing.T) {
		client := testutil.NewClient(t).As(testutil.NewUser(t))
		exhaust(client, realIP("203.0.113.1"))

		if status := hit(client, realIP("203.0.113.2")); status != http.StatusTooManyRequests {
			t.Fatalf("got %d", status)
		}
	})

	t.Run("ignores an invalid X-Real-IP behind a proxy", func(t *testing.T) {
		t.Setenv("IS_BEHIND_PROXY", "1")
		client := testutil.NewClient(t).As(testutil.NewUser(t))
		exhaust(client, realIP("not-an-ip"))

		if status := hit(client, realIP("also-not-an-ip")); status != http.StatusTooManyRequests {
			t.Fatalf("got %d", status)
		}
	})
}

func TestMaxBodySizeMiddleware(t *testing.T) {
	read := func(size int) error {
		var readErr error
		h := handlers.MaxBodySizeMiddleware(10)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, readErr = io.ReadAll(r.Body)
		}))
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/", strings.NewReader(strings.Repeat("a", size))))
		return readErr
	}

	if err := read(10); err != nil {
		t.Fatalf("body at the limit: %v", err)
	}
	if err := read(11); err == nil {
		t.Fatal("body over the limit was readable")
	}
}

func TestProtectedRoutesRequireLogin(t *testing.T) {
	testutil.RequireDB(t)

	routes := []struct{ method, path string }{
		{"GET", "/user"},
		{"POST", "/user/challenge"},
		{"POST", "/user/email"},
		{"POST", "/user/password"},
		{"POST", "/user/envelopes"},
		{"GET", "/user/sessions"},
		{"DELETE", "/user/sessions/x"},
		{"POST", "/user/push/subscribe"},
		{"POST", "/user/push/unsubscribe"},
		{"GET", "/user/push/test"},
		{"GET", "/user/settings"},
		{"POST", "/user/settings"},
		{"POST", "/calendar/events/save"},
		{"POST", "/calendar/events/sync"},
		{"POST", "/calendar/events/migrate-envelope"},
		{"GET", "/stripe/pricing"},
		{"POST", "/stripe/checkout"},
		{"GET", "/stripe/manage"},
	}
	for _, rt := range routes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			c := testutil.NewClient(t)

			status, reply := testutil.Call[any](c, rt.method, rt.path, []byte("{}"))
			if status != http.StatusUnauthorized || reply.Code != "not_logged_in" {
				t.Fatalf("got %d %+v", status, reply)
			}
		})
	}
}
