package handlers_test

import (
	"io"
	"net"
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
		{"get with foreign origin", "GET", "/user/sessions", withOrigin("https://evil.example"), http.StatusForbidden, "invalid_origin"},
		{"get with allowed origin", "GET", "/user/sessions", withOrigin(testutil.Origin), http.StatusOK, ""},
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

func TestStreamChecksAPresentOrigin(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	resp, _ := c.Do("GET", "/stream", nil, withOrigin("https://evil.example"))
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("got %d", resp.StatusCode)
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

	t.Run("groups IPv6 clients by /64 prefix behind a proxy", func(t *testing.T) {
		t.Setenv("IS_BEHIND_PROXY", "1")
		client := testutil.NewClient(t).As(testutil.NewUser(t))
		exhaust(client, realIP("2001:db8:1:2::1"))

		if status := hit(client, realIP("2001:db8:1:2:ffff:ffff:ffff:ffff")); status != http.StatusTooManyRequests {
			t.Fatalf("same /64: got %d", status)
		}
		if status := hit(client, realIP("2001:db8:1:3::1")); status != http.StatusOK {
			t.Fatalf("other /64: got %d", status)
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
		{"POST", "/user/reauth/start"},
		{"POST", "/user/email"},
		{"POST", "/user/password"},
		{"GET", "/user/sessions"},
		{"DELETE", "/user/sessions/x"},
		{"POST", "/user/push/subscribe"},
		{"POST", "/user/push/unsubscribe"},
		{"GET", "/user/push/test"},
		{"GET", "/user/settings"},
		{"POST", "/user/settings"},
		{"POST", "/calendar/events/save"},
		{"POST", "/calendar/events/sync"},
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

func rawRequest(t *testing.T, srv *httptest.Server, request string) net.Conn {
	t.Helper()

	conn, err := net.Dial("tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	if _, err := conn.Write([]byte(request)); err != nil {
		t.Fatal(err)
	}
	return conn
}

func TestDeadlineMiddleware(t *testing.T) {
	const deadline = 300 * time.Millisecond

	newServer := func(h http.HandlerFunc) *httptest.Server {
		srv := httptest.NewServer(handlers.DeadlineMiddleware(deadline)(h))
		t.Cleanup(srv.Close)
		return srv
	}
	await := func(t *testing.T, errs <-chan error) error {
		t.Helper()

		select {
		case err := <-errs:
			return err
		case <-time.After(5 * time.Second):
			t.Fatal("handler still blocked long after the deadline")
			return nil
		}
	}

	t.Run("stops a request body that arrives too slowly", func(t *testing.T) {
		errs := make(chan error, 1)
		srv := newServer(func(w http.ResponseWriter, r *http.Request) {
			_, err := io.ReadAll(r.Body)
			errs <- err
		})

		rawRequest(t, srv, "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\na")

		if err := await(t, errs); err == nil {
			t.Fatal("body read finished without error")
		}
	})

	t.Run("stops a response that is not being read", func(t *testing.T) {
		errs := make(chan error, 1)
		srv := newServer(func(w http.ResponseWriter, r *http.Request) {
			chunk := make([]byte, 1<<20)
			for range 256 {
				if _, err := w.Write(chunk); err != nil {
					errs <- err
					return
				}
			}
			errs <- nil
		})

		rawRequest(t, srv, "GET / HTTP/1.1\r\nHost: x\r\n\r\n")

		if err := await(t, errs); err == nil {
			t.Fatal("response was written in full to a client that never read")
		}
	})

	t.Run("lets a prompt request through", func(t *testing.T) {
		srv := newServer(func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			_, _ = w.Write(body)
		})

		resp, err := http.Post(srv.URL, "text/plain", strings.NewReader("hello"))
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()

		if body, _ := io.ReadAll(resp.Body); string(body) != "hello" {
			t.Fatalf("got %q", body)
		}
	})
}
