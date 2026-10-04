package handlers_test

import (
	"net/http"
	"strings"
	"testing"

	"acLife/constants"
	"acLife/internal/testutil"
	"acLife/types"
)

func saveSettings(c *testutil.Client, data string, baseVersion int) (int, types.Reply[types.EncryptedSettings]) {
	return testutil.Call[types.EncryptedSettings](c, "POST", "/user/settings", types.SaveSettingsRequest{Data: []byte(data), BaseVersion: baseVersion})
}

func getSettings(t *testing.T, c *testutil.Client) types.EncryptedSettings {
	t.Helper()

	status, reply := testutil.Call[types.EncryptedSettings](c, "GET", "/user/settings", nil)
	if status != http.StatusOK {
		t.Fatalf("get settings: %d", status)
	}
	return reply.Data
}

func TestSettingsStartEmptyAtVersionZero(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	got := getSettings(t, c)
	if got.Version != 0 || len(got.Data) != 0 {
		t.Fatalf("got %+v", got)
	}
}

func TestSettingsVersionsIncrementOnEachSave(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	if status, _ := saveSettings(c, "one", 0); status != http.StatusOK {
		t.Fatalf("first save: %d", status)
	}
	if got := getSettings(t, c); got.Version != 1 || string(got.Data) != "one" {
		t.Fatalf("got %+v", got)
	}

	if status, _ := saveSettings(c, "two", 1); status != http.StatusOK {
		t.Fatalf("second save: %d", status)
	}
	if got := getSettings(t, c); got.Version != 2 || string(got.Data) != "two" {
		t.Fatalf("got %+v", got)
	}
}

func TestSettingsStaleWritesConflictAndReturnCurrent(t *testing.T) {
	testutil.RequireDB(t)

	cases := []struct {
		name string
		base int
	}{
		{"behind", 1},
		{"initial write over existing", 0},
		{"ahead", 5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := testutil.NewClient(t).As(testutil.NewUser(t))
			saveSettings(c, "one", 0)
			saveSettings(c, "two", 1)

			status, reply := saveSettings(c, "stale", tc.base)
			if status != http.StatusConflict || reply.Success {
				t.Fatalf("got %d %+v", status, reply)
			}
			if reply.Data.Version != 2 || string(reply.Data.Data) != "two" {
				t.Fatalf("conflict reply %+v", reply.Data)
			}
			if got := getSettings(t, c); string(got.Data) != "two" || got.Version != 2 {
				t.Fatalf("stale write applied: %+v", got)
			}
		})
	}
}

func TestSettingsUpdateWithoutExistingRowConflicts(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	status, reply := saveSettings(c, "x", 1)
	if status != http.StatusConflict || reply.Data.Version != 0 {
		t.Fatalf("got %d %+v", status, reply)
	}
}

func TestSettingsRejectInvalidRequests(t *testing.T) {
	testutil.RequireDB(t)

	cases := map[string]any{
		"empty data":       types.SaveSettingsRequest{},
		"negative version": types.SaveSettingsRequest{Data: []byte("x"), BaseVersion: -1},
		"oversized data":   types.SaveSettingsRequest{Data: []byte(strings.Repeat("a", constants.MaxSettingsBytes+1))},
		"body over limit":  []byte(`{"data":"` + strings.Repeat("A", 192<<10) + `"}`),
		"unknown field":    []byte(`{"data":"eA==","baseVersion":0,"extra":1}`),
		"not json":         []byte("nope"),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			c := testutil.NewClient(t).As(testutil.NewUser(t))

			status, _ := testutil.Call[any](c, "POST", "/user/settings", body)
			if status != http.StatusBadRequest {
				t.Fatalf("got %d", status)
			}
			if got := getSettings(t, c); got.Version != 0 {
				t.Fatalf("rejected request stored: %+v", got)
			}
		})
	}
}

func TestSettingsAcceptMaxSize(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	if status, _ := saveSettings(c, strings.Repeat("a", constants.MaxSettingsBytes), 0); status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
}

func TestSettingsAreIsolatedBetweenUsers(t *testing.T) {
	testutil.RequireDB(t)
	srv := testutil.NewClient(t)
	a, b := srv.As(testutil.NewUser(t)), srv.As(testutil.NewUser(t))

	saveSettings(a, "secret-a", 0)

	if got := getSettings(t, b); got.Version != 0 || len(got.Data) != 0 {
		t.Fatalf("b sees %+v", got)
	}

	if status, _ := saveSettings(b, "mine", 0); status != http.StatusOK {
		t.Fatalf("b first save: %d", status)
	}
	if got := getSettings(t, a); string(got.Data) != "secret-a" || got.Version != 1 {
		t.Fatalf("a changed: %+v", got)
	}
}
