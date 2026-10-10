package handlers_test

import (
	"bytes"
	"log"
	"net/http"
	"strings"
	"sync"
	"testing"

	"acLife/constants"
	"acLife/internal/testutil"
)

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
		"at the cap":   {constants.MaxRequestRecords, http.StatusOK},
		"over the cap": {constants.MaxRequestRecords + 1, http.StatusBadRequest},
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

func TestConcurrentSavesCannotExceedTheStorageLimit(t *testing.T) {
	testutil.RequireDB(t)
	old := constants.MaxUserBytes
	constants.MaxUserBytes = 5 * fp(100)
	t.Cleanup(func() { constants.MaxUserBytes = old })
	user := testutil.NewUser(t)

	const writers = 10
	statuses := make([]int, writers)
	var wg sync.WaitGroup
	for i := range writers {
		wg.Go(func() {
			statuses[i] = save(testutil.NewClient(t).As(user), added(evSized(testutil.NewUUID(), baseTS, 100, testutil.BucketID(1))))
		})
	}
	wg.Wait()

	if used := stored(t, user.UUID); used != constants.MaxUserBytes {
		t.Fatalf("%d bytes stored, statuses %v", used, statuses)
	}
	requireCounter(t, user.UUID, constants.MaxUserBytes)
}

func TestSyncCapsTheRequest(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	id := testutil.UUIDToBase64(testutil.NewUUID())
	entries := func(n int) string {
		return strings.TrimSuffix(strings.Repeat(`{"id":"`+id+`","ts":1790000000000},`, n), ",")
	}
	buckets := `,"buckets":["` + testutil.BucketID(1) + `"]`

	t.Run("accepts a full cache", func(t *testing.T) {
		body := []byte(`{"records":[` + entries(constants.MaxRequestRecords) + `]` + buckets + `}`)
		if resp, _ := c.Do("POST", "/calendar/events/sync", body); resp.StatusCode != http.StatusOK {
			t.Fatalf("got %d", resp.StatusCode)
		}
	})
	t.Run("rejects more events than a user may own", func(t *testing.T) {
		body := []byte(`{"records":[` + entries(constants.MaxRequestRecords+1) + `]` + buckets + `}`)
		if resp, _ := c.Do("POST", "/calendar/events/sync", body); resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("got %d", resp.StatusCode)
		}
	})
	t.Run("rejects a body over 4 MB", func(t *testing.T) {
		body := []byte(`{"records":[]` + strings.Repeat(" ", 4<<20) + `}`)
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
	if resp, _ := c.Do("POST", "/calendar/events/sync", []byte(`{"records":[`+entries+`],"buckets":["`+testutil.BucketID(1)+`"]}`)); resp.StatusCode != http.StatusOK {
		t.Fatalf("got %d", resp.StatusCode)
	}

	if lines := strings.Count(out.String(), "InvalidUUID"); lines != 1 {
		t.Fatalf("%d log lines", lines)
	}
	if strings.Contains(out.String(), "forged") {
		t.Fatal("request content in the log")
	}
}

func TestSaveEnforcesTheStorageQuotaPerUser(t *testing.T) {
	testutil.RequireDB(t)
	size := int64(len(ev(testutil.NewUUID(), baseTS).Data)*3/4) + constants.BucketRowBytes
	old := constants.MaxUserBytes
	constants.MaxUserBytes = size*2 + size/2
	t.Cleanup(func() { constants.MaxUserBytes = old })

	c := testutil.NewClient(t).As(testutil.NewUser(t))
	bucket := testutil.BucketID(1)
	first, second, over := testutil.NewUUID(), testutil.NewUUID(), testutil.NewUUID()
	mustSave(t, c, added(ev(first, baseTS, bucket)), added(ev(second, baseTS, bucket)))

	status, reply := testutil.Call[any](c, "POST", "/calendar/events/save", []any{added(ev(over, baseTS, bucket))})
	if status != http.StatusRequestEntityTooLarge || reply.Code != "storage_limit_reached" {
		t.Fatalf("got %d %q", status, reply.Code)
	}
	if count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", over) != 0 {
		t.Fatal("rejected event stored")
	}

	t.Run("replacing within the quota works", func(t *testing.T) {
		mustSave(t, c, deleted(first), added(ev(over, baseTS, bucket)))
	})
	t.Run("other users are unaffected", func(t *testing.T) {
		other := testutil.NewClient(t).As(testutil.NewUser(t))
		mustSave(t, other, added(ev(testutil.NewUUID(), baseTS, bucket)), added(ev(testutil.NewUUID(), baseTS, bucket)))
	})
}
