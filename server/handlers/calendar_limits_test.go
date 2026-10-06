package handlers_test

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"testing"

	"acLife/constants"
	"acLife/internal/testutil"
	"acLife/types"
)

func fillEvents(t *testing.T, owner string, n int) {
	t.Helper()

	const chunk = 10000
	for left := n; left > 0; left -= chunk {
		ids := make([]string, min(chunk, left))
		for i := range ids {
			ids[i] = testutil.NewUUID()
		}
		insertLegacyEvents(t, owner, ids...)
	}
}

func deletesBody(n int) []byte {
	entry := `{"type":"deleted","id":"` + testutil.NewUUID() + `"}`
	return []byte("[" + strings.TrimSuffix(strings.Repeat(entry+",", n), ",") + "]")
}

func TestSaveCapsTheNumberOfChanges(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	for name, tc := range map[string]struct {
		n      int
		status int
	}{
		"at the cap":   {constants.MaxUserEvents, http.StatusOK},
		"over the cap": {constants.MaxUserEvents + 1, http.StatusBadRequest},
	} {
		t.Run(name, func(t *testing.T) {
			if resp, _ := c.Do("POST", "/calendar/events/save", deletesBody(tc.n)); resp.StatusCode != tc.status {
				t.Fatalf("got %d", resp.StatusCode)
			}
		})
	}
}

func TestSaveRejectsDeleteOfAnInvalidID(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	keep := testutil.NewUUID()
	mustSave(t, c, added(ev(keep, baseTS, testutil.BucketID(1))))

	for _, id := range []string{"x", "", strings.Repeat("a", 100000)} {
		if status := save(c, deleted(id), deleted(keep)); status != http.StatusBadRequest {
			t.Fatalf("id %.10q: got %d", id, status)
		}
	}
	if count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", keep) != 1 {
		t.Fatal("batch partly applied")
	}
}

func TestMigrateEnvelopeCapsTheNumberOfChanges(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	envelopes := []types.KeyEnvelope{{Type: "master", Version: 1, Salt: bytes.Repeat([]byte{1}, 16), Data: bytes.Repeat([]byte{2}, 32), KDFParams: "{}"}}
	envelopesJSON, err := json.Marshal(envelopes)
	if err != nil {
		t.Fatal(err)
	}

	body := []byte(`{"envelopes":` + string(envelopesJSON) + `,"events":` + string(deletesBody(constants.MaxUserEvents+1)) + `}`)
	if resp, _ := c.Do("POST", "/calendar/events/migrate-envelope", body); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("got %d", resp.StatusCode)
	}
	if count(t, "SELECT COUNT(*) FROM key_envelopes WHERE owner = ?", user.UUID) != 0 {
		t.Fatal("envelope stored")
	}

	if status, _ := testutil.Call[any](c, "POST", "/calendar/events/migrate-envelope", map[string]any{"envelopes": envelopes, "events": []any{}}); status != http.StatusOK {
		t.Fatalf("valid migration: got %d", status)
	}
}

func TestSaveEnforcesTheEventLimitPerUser(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	fillEvents(t, user.UUID, constants.MaxUserEvents-1)
	bucket := testutil.BucketID(1)
	last, over := testutil.NewUUID(), testutil.NewUUID()

	mustSave(t, c, added(ev(last, baseTS, bucket)))

	status, reply := testutil.Call[any](c, "POST", "/calendar/events/save", []any{added(ev(over, baseTS, bucket))})
	if status != http.StatusRequestEntityTooLarge || reply.Code != "event_limit_reached" {
		t.Fatalf("got %d %q", status, reply.Code)
	}
	if count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", over) != 0 || count(t, "SELECT COUNT(*) FROM calendar_event_buckets WHERE event_id = ?", over) != 0 {
		t.Fatal("rejected event stored")
	}

	t.Run("updating at the limit works", func(t *testing.T) {
		mustSave(t, c, updated(ev(last, baseTS+1, bucket)))
	})
	t.Run("replacing at the limit works", func(t *testing.T) {
		mustSave(t, c, deleted(last), added(ev(over, baseTS, bucket)))
	})
	t.Run("deleting at the limit works", func(t *testing.T) {
		mustSave(t, c, deleted(over))
	})
	t.Run("other users are unaffected", func(t *testing.T) {
		mustSave(t, testutil.NewClient(t).As(testutil.NewUser(t)), added(ev(testutil.NewUUID(), baseTS, bucket)))
	})
}

func TestConcurrentSavesCannotExceedTheEventLimit(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	fillEvents(t, user.UUID, constants.MaxUserEvents-1)

	const writers = 10
	statuses := make([]int, writers)
	var wg sync.WaitGroup
	for i := range writers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses[i] = save(c, added(ev(testutil.NewUUID(), baseTS, testutil.BucketID(1))))
		}()
	}
	wg.Wait()

	if n := count(t, "SELECT COUNT(*) FROM calendar_events WHERE owner = ?", user.UUID); n != constants.MaxUserEvents {
		t.Fatalf("%d events stored, statuses %v", n, statuses)
	}
}

func TestSyncCapsTheRequest(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	id := testutil.UUIDToBase64(testutil.NewUUID())
	entries := func(n int) string {
		return strings.TrimSuffix(strings.Repeat(`{"id":"`+id+`","ts":1790000000000},`, n), ",")
	}

	t.Run("accepts a full cache", func(t *testing.T) {
		body := []byte(`{"events":[` + entries(constants.MaxUserEvents) + `]}`)
		if resp, _ := c.Do("POST", "/calendar/events/sync", body); resp.StatusCode != http.StatusOK {
			t.Fatalf("got %d", resp.StatusCode)
		}
	})
	t.Run("rejects more events than a user may own", func(t *testing.T) {
		body := []byte(`{"events":[` + entries(constants.MaxUserEvents+1) + `]}`)
		if resp, _ := c.Do("POST", "/calendar/events/sync", body); resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("got %d", resp.StatusCode)
		}
	})
	t.Run("rejects a body over 4 MB", func(t *testing.T) {
		body := []byte(`{"events":[]` + strings.Repeat(" ", 4<<20) + `}`)
		if resp, _ := c.Do("POST", "/calendar/events/sync", body); resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("got %d", resp.StatusCode)
		}
	})
}

func TestSyncLogsInvalidIDsOnce(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	var out bytes.Buffer
	original := log.Writer()
	log.SetOutput(&out)
	t.Cleanup(func() { log.SetOutput(original) })

	entries := strings.TrimSuffix(strings.Repeat(`{"id":"bad\nforged line","ts":1},`, 500), ",")
	if resp, _ := c.Do("POST", "/calendar/events/sync", []byte(`{"events":[`+entries+`]}`)); resp.StatusCode != http.StatusOK {
		t.Fatalf("got %d", resp.StatusCode)
	}

	if lines := strings.Count(out.String(), "InvalidUUID"); lines != 1 {
		t.Fatalf("%d log lines", lines)
	}
	if strings.Contains(out.String(), "forged") {
		t.Fatal("request content in the log")
	}
}
