package handlers_test

import (
	"encoding/base64"
	"net/http"
	"testing"

	"acLife/internal/testutil"
)

func subscribePush(t *testing.T, endpoint string) int {
	t.Helper()

	c := testutil.NewClient(t).As(testutil.NewUser(t))
	status, _ := testutil.Call[any](c, "POST", "/user/push/subscribe", map[string]string{
		"endpoint": endpoint,
		"auth":     base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
		"p256dh":   base64.RawURLEncoding.EncodeToString(make([]byte, 65)),
	})
	return status
}

func TestPushSubscribeOnlyAcceptsKnownPushServicesByDefault(t *testing.T) {
	testutil.RequireDB(t)

	cases := map[string]int{
		"https://updates.push.services.mozilla.com/wpush/v2/x": http.StatusOK,
		"https://fcm.googleapis.com/fcm/send/x":                http.StatusOK,
		"https://wns2-par02p.notify.windows.com/w/x":           http.StatusOK,
		"https://api.push.apple.com/3/device/x":                http.StatusOK,
		"https://internal.example/hook":                        http.StatusBadRequest,
		"https://googleapis.com.evil.example/x":                http.StatusBadRequest,
		"https://evil.example/?h=fcm.googleapis.com":           http.StatusBadRequest,
		"http://fcm.googleapis.com/fcm/send/x":                 http.StatusBadRequest,
	}
	for endpoint, want := range cases {
		t.Run(endpoint, func(t *testing.T) {
			if got := subscribePush(t, endpoint); got != want {
				t.Fatalf("got %d", got)
			}
		})
	}
}

func TestPushSubscribeHonoursTheConfiguredHosts(t *testing.T) {
	testutil.RequireDB(t)
	t.Setenv("PUSH_ALLOWED_ENDPOINTS", "push.example")

	if got := subscribePush(t, "https://push.example/x"); got != http.StatusOK {
		t.Fatalf("configured host: %d", got)
	}
	if got := subscribePush(t, "https://fcm.googleapis.com/x"); got != http.StatusBadRequest {
		t.Fatalf("default host after override: %d", got)
	}
}
