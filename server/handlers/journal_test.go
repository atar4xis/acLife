package handlers_test

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/handlers"
	"acLife/internal/testutil"
	"acLife/stream"
	"acLife/types"
)

func jid(bucket string, n int) string {
	return fmt.Sprintf("%s%06x-0000-4000-8000-000000000000", bucket, n)
}

func jev(id string, ts int64) types.EncryptedRecord {
	return types.EncryptedRecord{ID: id, Data: base64.StdEncoding.EncodeToString([]byte("data-" + id)), UpdatedAt: ts}
}

func recordIDs(records []types.EncryptedRecord) []string {
	ids := make([]string, 0, len(records))
	for _, r := range records {
		ids = append(ids, r.ID)
	}
	slices.Sort(ids)
	return ids
}

func jadded(e types.EncryptedRecord) handlers.JournalChange {
	return handlers.JournalChange{Type: "added", Record: e}
}

func jupdated(e types.EncryptedRecord) handlers.JournalChange {
	return handlers.JournalChange{Type: "updated", Record: e}
}

func jdeleted(id string) handlers.JournalChange {
	return handlers.JournalChange{Type: "deleted", ID: id}
}

func jevSized(id string, ts int64, size int) types.EncryptedRecord {
	e := jev(id, ts)
	e.Data = base64.StdEncoding.EncodeToString([]byte(strings.Repeat("x", size)))
	return e
}

func sameEvent(a, b types.EncryptedRecord) bool {
	return a.ID == b.ID && a.Data == b.Data && a.UpdatedAt == b.UpdatedAt
}

func jsaveStatus(c *testutil.Client, changes ...handlers.JournalChange) int {
	status, _ := testutil.Call[any](c, "POST", "/journal/save", changes)
	return status
}

func jsave(t *testing.T, c *testutil.Client, changes ...handlers.JournalChange) {
	t.Helper()
	if status := jsaveStatus(c, changes...); status != http.StatusOK {
		t.Fatalf("journal save: got %d", status)
	}
}

func jsyncStatus(c *testutil.Client, req types.JournalSyncRequest) (int, types.JournalSyncResponse) {
	status, reply := testutil.Call[types.JournalSyncResponse](c, "POST", "/journal/sync", req)
	return status, reply.Data
}

func jsync(t *testing.T, c *testutil.Client, buckets []string, items ...types.CachedRecord) types.JournalSyncResponse {
	t.Helper()

	status, res := jsyncStatus(c, types.JournalSyncRequest{Buckets: buckets, Records: items})
	if status != http.StatusOK {
		t.Fatalf("journal sync: got %d", status)
	}
	return res
}

func jhash(t *testing.T, c *testutil.Client, hash string) types.JournalHashResponse {
	t.Helper()

	status, reply := testutil.Call[types.JournalHashResponse](c, "POST", "/journal/sync", types.JournalSyncRequest{Hash: hash})
	if status != http.StatusOK {
		t.Fatalf("journal hash: got %d", status)
	}
	return reply.Data
}

func jcached(id string, ts int64) types.CachedRecord {
	return types.CachedRecord{ID: id, Timestamp: ts}
}

func jbuckets() []string {
	names := make([]string, 256)
	for i := range names {
		names[i] = fmt.Sprintf("%02x", i)
	}
	return names
}

func jstored(t *testing.T, owner string) int64 {
	t.Helper()

	var used int64
	if err := database.DB.QueryRow("SELECT COALESCE(SUM(OCTET_LENGTH(data)), 0) FROM journal_items WHERE owner = ?", owner).Scan(&used); err != nil {
		t.Fatal(err)
	}
	return used
}

func jdata(t *testing.T, id string) (string, int64) {
	t.Helper()

	var data []byte
	var updatedAt time.Time
	if err := database.DB.QueryRow("SELECT data, updated_at FROM journal_items WHERE id = ?", id).Scan(&data, &updatedAt); err != nil {
		t.Fatal(err)
	}
	return string(data), updatedAt.UnixMilli()
}

func jline(id string, ts int64) string {
	return fmt.Sprintf("%s:%d", id, ts)
}

func jpull(t *testing.T, user testutil.User, local map[string]int64) (pages int) {
	t.Helper()

	buckets := jbuckets()
	for len(buckets) > 0 {
		batch := buckets[:min(constants.MaxJournalSyncBuckets, len(buckets))]
		buckets = buckets[len(batch):]
		for len(batch) > 0 {
			var items []types.CachedRecord
			for id, ts := range local {
				items = append(items, jcached(id, ts))
			}
			res := jsync(t, testutil.NewClient(t).As(user), batch, items...)
			pages++
			for _, e := range slices.Concat(res.Added, res.Updated) {
				local[e.ID] = e.UpdatedAt
			}
			for _, id := range res.Deleted {
				delete(local, id)
			}
			if len(res.Remaining) > 0 && len(res.Added)+len(res.Updated) == 0 {
				t.Fatal("page without progress")
			}
			batch = res.Remaining
		}
	}
	return pages
}

func TestJournalRoutesAreGated(t *testing.T) {
	testutil.RequireDB(t)

	t.Run("require login", func(t *testing.T) {
		c := testutil.NewClient(t)
		if status, _ := testutil.Call[any](c, "POST", "/journal/save", []any{}); status != http.StatusUnauthorized {
			t.Fatalf("save: got %d", status)
		}
		if status, _ := testutil.Call[any](c, "POST", "/journal/sync", types.JournalSyncRequest{Hash: "x"}); status != http.StatusUnauthorized {
			t.Fatalf("sync: got %d", status)
		}
	})

	t.Run("work without a subscription when the server does not require one", func(t *testing.T) {
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		jsave(t, c, jadded(jev(jid("aa", 1), baseTS)))
		if res := jsync(t, c, []string{"aa"}); len(res.Added) != 1 {
			t.Fatalf("got %+v", res)
		}
	})

	t.Run("need a subscription when the server requires one", func(t *testing.T) {
		requireSubscription(t)

		c := testutil.NewClient(t).As(testutil.NewUser(t))
		if status, reply := testutil.Call[any](c, "POST", "/journal/save", []any{}); status != http.StatusPaymentRequired || reply.Code != "invalid_subscription" {
			t.Fatalf("save: got %d %q", status, reply.Code)
		}
		if status, _ := testutil.Call[any](c, "POST", "/journal/sync", types.JournalSyncRequest{Hash: "x"}); status != http.StatusPaymentRequired {
			t.Fatalf("sync: got %d", status)
		}

		active := testutil.NewClient(t).As(testutil.NewUser(t, testutil.Subscribed("active")))
		jsave(t, active, jadded(jev(jid("aa", 2), baseTS)))
		if res := jsync(t, active, []string{"aa"}); len(res.Added) != 1 {
			t.Fatalf("got %+v", res)
		}
	})
}

func TestJournalSaveAcceptsAnEmptyList(t *testing.T) {
	testutil.RequireDB(t)
	jsave(t, testutil.NewClient(t).As(testutil.NewUser(t)))
}

func TestJournalSaveRejectsBadBatches(t *testing.T) {
	testutil.RequireDB(t)
	good := jid("aa", 1)
	big := jev(jid("aa", 2), baseTS)
	big.Data = base64.StdEncoding.EncodeToString(make([]byte, constants.MaxJournalLen+1))
	bad := func(e types.EncryptedRecord, mod func(*types.EncryptedRecord)) handlers.JournalChange {
		mod(&e)
		return jadded(e)
	}

	cases := []struct {
		name   string
		change handlers.JournalChange
	}{
		{"added id is not a uuid", bad(jev(good, baseTS), func(e *types.EncryptedRecord) { e.ID = "not-a-uuid" })},
		{"deleted id is not a uuid", handlers.JournalChange{Type: "deleted", ID: "nope"}},
		{"timestamp too low", bad(jev(good, baseTS), func(e *types.EncryptedRecord) { e.UpdatedAt = constants.MinRecordTimestampMs - 1 })},
		{"timestamp too high", bad(jev(good, baseTS), func(e *types.EncryptedRecord) { e.UpdatedAt = constants.MaxRecordTimestampMs + 1 })},
		{"data is not base64", bad(jev(good, baseTS), func(e *types.EncryptedRecord) { e.Data = "***" })},
		{"data too long", jadded(big)},
		{"unknown type", handlers.JournalChange{Type: "moved", Record: jev(good, baseTS)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := testutil.NewClient(t).As(testutil.NewUser(t))
			other := jid("bb", 9)
			if status := jsaveStatus(c, jadded(jev(other, baseTS)), tc.change); status != http.StatusBadRequest {
				t.Fatalf("got %d", status)
			}
			if n := count(t, "SELECT COUNT(*) FROM journal_items WHERE id = ?", other); n != 0 {
				t.Fatal("part of a rejected batch was stored")
			}
		})
	}

	t.Run("data of exactly the maximum length is accepted", func(t *testing.T) {
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		jsave(t, c, jadded(jevSized(good, baseTS, constants.MaxJournalLen)))
	})
	t.Run("timestamps at the bounds are accepted", func(t *testing.T) {
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		jsave(t, c, jadded(jev(jid("cc", 1), constants.MinRecordTimestampMs)), jadded(jev(jid("cc", 2), constants.MaxRecordTimestampMs)))
	})
}

func TestJournalSaveThenSyncRoundTrip(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	writer := testutil.NewClient(t).As(user)
	reader := testutil.NewClient(t).As(user)
	a, b := jid("ab", 1), jid("ab", 2)

	jsave(t, writer, jadded(jev(a, baseTS)), jadded(jev(b, baseTS+5)))

	res := jsync(t, reader, []string{"ab"})
	if len(res.Added) != 2 || len(res.Updated) != 0 || len(res.Deleted) != 0 || len(res.Remaining) != 0 {
		t.Fatalf("got %+v", res)
	}
	for i, want := range []types.EncryptedRecord{jev(a, baseTS), jev(b, baseTS+5)} {
		if !sameEvent(res.Added[i], want) {
			t.Fatalf("added %d: got %+v, want %+v", i, res.Added[i], want)
		}
	}

	jsave(t, writer, jupdated(jev(a, baseTS+10)))
	res = jsync(t, reader, []string{"ab"}, jcached(a, baseTS), jcached(b, baseTS+5))
	if len(res.Added) != 0 || len(res.Updated) != 1 || !sameEvent(res.Updated[0], jev(a, baseTS+10)) {
		t.Fatalf("got %+v", res)
	}
}

func TestJournalSaveDeletesTheRow(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	a, b := jid("ab", 1), jid("ab", 2)
	jsave(t, c, jadded(jev(a, baseTS)), jadded(jev(b, baseTS)))

	jsave(t, c, jdeleted(a))

	if n := count(t, "SELECT COUNT(*) FROM journal_items WHERE id = ?", a); n != 0 {
		t.Fatal("row still stored")
	}
	res := jsync(t, c, []string{"ab"}, jcached(a, baseTS), jcached(b, baseTS))
	if len(res.Added)+len(res.Updated) != 0 || !slices.Equal(res.Deleted, []string{a}) {
		t.Fatalf("got %+v", res)
	}
}

func TestJournalSaveLastChangeOfAnIDWins(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	gone, kept := jid("ab", 1), jid("ab", 2)

	jsave(t, c, jadded(jev(gone, baseTS)), jdeleted(gone), jdeleted(kept), jadded(jev(kept, baseTS)))

	if n := count(t, "SELECT COUNT(*) FROM journal_items WHERE id = ?", gone); n != 0 {
		t.Fatal("created then deleted item stored")
	}
	if n := count(t, "SELECT COUNT(*) FROM journal_items WHERE id = ?", kept); n != 1 {
		t.Fatal("deleted then created item missing")
	}
}

func TestJournalSaveNormalizesUppercaseIDs(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	id := jid("ab", 10)

	jsave(t, c, jadded(jev(strings.ToUpper(id), baseTS)))
	jsave(t, c, jupdated(jev(id, baseTS+1)))

	if n := count(t, "SELECT COUNT(*) FROM journal_items WHERE id = ? AND BINARY id = ?", id, id); n != 1 {
		t.Fatalf("got %d rows with the lowercase id", n)
	}
	res := jsync(t, c, []string{"ab"})
	if len(res.Added) != 1 || res.Added[0].ID != id || res.Added[0].UpdatedAt != baseTS+1 {
		t.Fatalf("got %+v", res)
	}

	jsave(t, c, jdeleted(strings.ToUpper(id)))
	if n := count(t, "SELECT COUNT(*) FROM journal_items"); n != 0 {
		t.Fatal("uppercase delete missed the row")
	}
}

func TestJournalSaveKeepsTheNewerVersion(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	id := jid("ab", 1)
	version := func(ts int64, text string) types.EncryptedRecord {
		e := jev(id, ts)
		e.Data = base64.StdEncoding.EncodeToString([]byte(text))
		return e
	}

	jsave(t, c, jadded(version(baseTS, "first")))

	t.Run("older is ignored", func(t *testing.T) {
		jsave(t, c, jupdated(version(baseTS-1, "older and longer than the first")))
		if data, ts := jdata(t, id); data != "first" || ts != baseTS {
			t.Fatalf("got %q at %d", data, ts)
		}
		if got, want := counter(t, user.UUID), int64(len("first")); got != want {
			t.Fatalf("counter %d, want %d", got, want)
		}
	})
	t.Run("equal is applied", func(t *testing.T) {
		jsave(t, c, jupdated(version(baseTS, "equal")))
		if data, ts := jdata(t, id); data != "equal" || ts != baseTS {
			t.Fatalf("got %q at %d", data, ts)
		}
	})
	t.Run("newer is applied", func(t *testing.T) {
		jsave(t, c, jupdated(version(baseTS+1, "newer")))
		if data, ts := jdata(t, id); data != "newer" || ts != baseTS+1 {
			t.Fatalf("got %q at %d", data, ts)
		}
	})
}

func TestJournalIsIsolatedBetweenUsers(t *testing.T) {
	testutil.RequireDB(t)
	owner, other := testutil.NewUser(t), testutil.NewUser(t)
	oc, xc := testutil.NewClient(t).As(owner), testutil.NewClient(t).As(other)
	id := jid("ab", 1)
	jsave(t, oc, jadded(jev(id, baseTS)))
	before := counter(t, owner.UUID)

	jsave(t, xc, jupdated(jevSized(id, baseTS+100, 7)))
	jsave(t, xc, jdeleted(id))

	if data, ts := jdata(t, id); data != "data-"+id || ts != baseTS {
		t.Fatalf("foreign write changed the row: %q at %d", data, ts)
	}
	if counter(t, owner.UUID) != before {
		t.Fatal("foreign write changed the owner's counter")
	}
	if res := jsync(t, xc, []string{"ab"}); len(res.Added) != 0 {
		t.Fatalf("other user sees %+v", res)
	}
	if res := jsync(t, xc, []string{"ab"}, jcached(id, baseTS)); !slices.Equal(res.Deleted, []string{id}) {
		t.Fatalf("got %+v", res)
	}
	if h := jhash(t, xc, handlers.BucketHash(nil)); !h.Match {
		t.Fatal("other user's hash includes foreign items")
	}
}

func TestJournalGlobalHash(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	a, b := jid("ab", 1), jid("cd", 2)

	t.Run("an empty journal matches the hash of no lines", func(t *testing.T) {
		if res := jhash(t, c, handlers.BucketHash(nil)); !res.Match || res.Table != "" {
			t.Fatalf("got %+v", res)
		}
	})

	jsave(t, c, jadded(jev(a, baseTS)), jadded(jev(b, baseTS+1)))

	t.Run("the same items match whatever their order", func(t *testing.T) {
		if res := jhash(t, c, handlers.BucketHash([]string{jline(b, baseTS+1), jline(a, baseTS)})); !res.Match || res.Table != "" {
			t.Fatalf("got %+v", res)
		}
	})
	t.Run("a different timestamp does not match", func(t *testing.T) {
		if res := jhash(t, c, handlers.BucketHash([]string{jline(a, baseTS+1), jline(b, baseTS+1)})); res.Match || len(res.Table) == 0 {
			t.Fatalf("got %+v", res)
		}
	})
	t.Run("a missing item does not match", func(t *testing.T) {
		if res := jhash(t, c, handlers.BucketHash([]string{jline(a, baseTS)})); res.Match {
			t.Fatal("matched")
		}
	})
	t.Run("an extra item does not match", func(t *testing.T) {
		lines := []string{jline(a, baseTS), jline(b, baseTS+1), jline(jid("ef", 3), baseTS)}
		if res := jhash(t, c, handlers.BucketHash(lines)); res.Match {
			t.Fatal("matched")
		}
	})
}

func TestJournalHashTable(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	first, second, third := jid("0a", 1), jid("0a", 2), jid("ff", 3)
	jsave(t, c, jadded(jev(first, baseTS)), jadded(jev(second, baseTS+1)), jadded(jev(third, baseTS+2)))

	res := jhash(t, c, handlers.BucketHash(nil))
	if res.Match {
		t.Fatal("matched")
	}

	byBucket := map[string][]string{
		"0a": {jline(second, baseTS+1), jline(first, baseTS)},
		"ff": {jline(third, baseTS+2)},
	}
	var want strings.Builder
	for _, b := range jbuckets() {
		want.WriteString(handlers.BucketHash(byBucket[b])[:constants.JournalHashChars])
	}
	if len(res.Table) != 256*constants.JournalHashChars {
		t.Fatalf("table length %d", len(res.Table))
	}
	if res.Table != want.String() {
		t.Fatalf("table differs\ngot  %s\nwant %s", res.Table, want.String())
	}

	empty := handlers.BucketHash(nil)[:constants.JournalHashChars]
	if got := res.Table[3*constants.JournalHashChars : 4*constants.JournalHashChars]; got != empty {
		t.Fatalf("empty bucket 03: got %q, want %q", got, empty)
	}
	if got := res.Table[0x0a*constants.JournalHashChars : 0x0b*constants.JournalHashChars]; got == empty {
		t.Fatal("bucket 0a is empty in the table")
	}
}

func TestJournalSyncDiffIsScopedToTheRequestedBuckets(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	same, stale, clientNewer, missing := jid("00", 1), jid("00", 2), jid("01", 3), jid("01", 4)
	onlyServer, outside, ghost, clientGhost := jid("00", 5), jid("ab", 6), jid("01", 7), jid("ff", 8)
	jsave(t, c,
		jadded(jev(same, baseTS)), jadded(jev(stale, baseTS+10)), jadded(jev(clientNewer, baseTS)),
		jadded(jev(onlyServer, baseTS)), jadded(jev(outside, baseTS)),
	)

	res := jsync(t, c, []string{"01", "00"},
		jcached(same, baseTS), jcached(stale, baseTS), jcached(clientNewer, baseTS+50),
		jcached(missing, baseTS), jcached(ghost, baseTS), jcached(clientGhost, baseTS),
	)

	if got := recordIDs(res.Added); !slices.Equal(got, []string{onlyServer}) {
		t.Fatalf("added %v", got)
	}
	if got := recordIDs(res.Updated); !slices.Equal(got, []string{stale}) {
		t.Fatalf("updated %v", got)
	}
	if want := []string{missing, ghost}; !slices.Equal(res.Deleted, want) {
		t.Fatalf("deleted %v, want %v", res.Deleted, want)
	}
	if len(res.Remaining) != 0 {
		t.Fatalf("remaining %v", res.Remaining)
	}
}

func TestJournalSyncIgnoresIDCaseAndDuplicateBuckets(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	id := jid("ab", 1)
	jsave(t, c, jadded(jev(id, baseTS)))

	res := jsync(t, c, []string{"ab", "ab"}, jcached(strings.ToUpper(id), baseTS))
	if len(res.Added)+len(res.Updated)+len(res.Deleted) != 0 {
		t.Fatalf("got %+v", res)
	}
}

func TestJournalSyncPagesByBytes(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	ids := []string{jid("00", 1), jid("00", 2), jid("01", 3), jid("02", 4), jid("02", 5)}
	changes := make([]handlers.JournalChange, len(ids))
	for i, id := range ids {
		changes[i] = jadded(jevSized(id, baseTS, 100))
	}
	jsave(t, c, changes...)
	size := len(jevSized(ids[0], baseTS, 100).Data)

	t.Run("a page always holds at least one item", func(t *testing.T) {
		handlers.SetJournalSyncBytes(1)
		t.Cleanup(func() { handlers.SetJournalSyncBytes(constants.MaxJournalSyncBytes) })

		res := jsync(t, c, []string{"00", "01", "02"})
		if len(res.Added) != 1 || res.Added[0].ID != ids[0] {
			t.Fatalf("got %+v", res.Added)
		}
		if !slices.Equal(res.Remaining, []string{"00", "01", "02"}) {
			t.Fatalf("remaining %v", res.Remaining)
		}

		local := map[string]int64{}
		if pages := jpull(t, user, local); pages != len(ids)+255/constants.MaxJournalSyncBuckets {
			t.Fatalf("%d pages", pages)
		}
		if len(local) != len(ids) {
			t.Fatalf("got %d items", len(local))
		}
	})

	t.Run("the last item that reaches the cap leaves nothing remaining", func(t *testing.T) {
		handlers.SetJournalSyncBytes(int64(size * 5))
		t.Cleanup(func() { handlers.SetJournalSyncBytes(constants.MaxJournalSyncBytes) })

		res := jsync(t, c, []string{"00", "01", "02"})
		if len(res.Added) != 5 || len(res.Remaining) != 0 {
			t.Fatalf("got %d items, remaining %v", len(res.Added), res.Remaining)
		}
	})

	t.Run("the remaining buckets start where the page stopped", func(t *testing.T) {
		handlers.SetJournalSyncBytes(int64(size * 2))
		t.Cleanup(func() { handlers.SetJournalSyncBytes(constants.MaxJournalSyncBytes) })

		res := jsync(t, c, []string{"00", "01", "02"})
		if len(res.Added) != 2 || !slices.Equal(res.Remaining, []string{"01", "02"}) {
			t.Fatalf("got %d items, remaining %v", len(res.Added), res.Remaining)
		}
	})
}

func TestJournalSyncRejectsBadRequests(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	cases := []struct {
		name string
		req  types.JournalSyncRequest
	}{
		{"nothing requested", types.JournalSyncRequest{}},
		{"no buckets", types.JournalSyncRequest{Records: []types.CachedRecord{jcached(jid("ab", 1), baseTS)}}},
		{"too many buckets", types.JournalSyncRequest{Buckets: jbuckets()[:constants.MaxJournalSyncBuckets+1]}},
		{"uppercase bucket", types.JournalSyncRequest{Buckets: []string{"AB"}}},
		{"short bucket", types.JournalSyncRequest{Buckets: []string{"a"}}},
		{"long bucket", types.JournalSyncRequest{Buckets: []string{"abc"}}},
		{"non hex bucket", types.JournalSyncRequest{Buckets: []string{"zz"}}},
		{"too many items", types.JournalSyncRequest{Buckets: []string{"ab"}, Records: make([]types.CachedRecord, constants.MaxRequestRecords+1)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if status, _ := jsyncStatus(c, tc.req); status != http.StatusBadRequest {
				t.Fatalf("got %d", status)
			}
		})
	}

	t.Run("the maximum number of items is accepted", func(t *testing.T) {
		items := make([]types.CachedRecord, constants.MaxRequestRecords)
		for i := range items {
			items[i] = jcached(jid("ab", i), baseTS)
		}
		if status, _ := jsyncStatus(c, types.JournalSyncRequest{Buckets: []string{"ab"}, Records: items}); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
	})

	t.Run("the maximum number of buckets is accepted", func(t *testing.T) {
		if status, _ := jsyncStatus(c, types.JournalSyncRequest{Buckets: jbuckets()[:constants.MaxJournalSyncBuckets]}); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
	})
}

func TestJournalSyncHandlesManyItems(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	writer := testutil.NewClient(t).As(user)
	reader := testutil.NewClient(t).As(user)
	const total = 1200

	want := make(map[string]int64, total)
	changes := make([]handlers.JournalChange, 0, total)
	for i, b := range jbuckets() {
		for j := range total/256 + 1 {
			if len(changes) == total {
				break
			}
			id := jid(b, i*8+j)
			want[id] = baseTS + int64(len(changes))
			changes = append(changes, jadded(jev(id, want[id])))
		}
	}
	jsave(t, writer, changes...)

	local := map[string]int64{}
	jpull(t, user, local)
	if len(local) != total {
		t.Fatalf("pulled %d of %d", len(local), total)
	}
	for id, ts := range want {
		if local[id] != ts {
			t.Fatalf("item %s: got %d, want %d", id, local[id], ts)
		}
	}

	lines := make([]string, 0, total)
	for id, ts := range local {
		lines = append(lines, jline(id, ts))
	}
	if res := jhash(t, reader, handlers.BucketHash(lines)); !res.Match {
		t.Fatal("hash differs after a full pull")
	}
}

func TestJournalCountsTowardTheSharedQuota(t *testing.T) {
	testutil.RequireDB(t)

	t.Run("journal and events share one counter", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		mustSave(t, c, added(evSized(testutil.NewUUID(), baseTS, 10, testutil.BucketID(1))))
		jsave(t, c, jadded(jevSized(jid("ab", 11), baseTS, 30)), jadded(jevSized(jid("ab", 12), baseTS, 5)))

		requireCounter(t, user.UUID, fp(10)+35)
		jsave(t, c, jdeleted(jid("ab", 11)))
		requireCounter(t, user.UUID, fp(10)+5)
		mustSave(t, c, deleted(testutil.NewUUID()))
		requireCounter(t, user.UUID, fp(10)+5)
	})

	t.Run("a journal save over the limit answers 413 and stores nothing", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		setLimit(t, user.UUID, 100)
		jsave(t, c, jadded(jevSized(jid("ab", 21), baseTS, 60)))

		status, reply := testutil.Call[any](c, "POST", "/journal/save", []handlers.JournalChange{jadded(jevSized(jid("ab", 22), baseTS, 60))})
		if status != http.StatusRequestEntityTooLarge || reply.Code != "storage_limit_reached" {
			t.Fatalf("got %d %q", status, reply.Code)
		}
		if n := count(t, "SELECT COUNT(*) FROM journal_items WHERE owner = ?", user.UUID); n != 1 {
			t.Fatalf("%d rows", n)
		}
		requireCounter(t, user.UUID, 60)
	})

	t.Run("journal bytes block event saves too", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		setLimit(t, user.UUID, fp(10)+50)
		jsave(t, c, jadded(jevSized(jid("ab", 31), baseTS, 60)))

		if status := save(c, added(evSized(testutil.NewUUID(), baseTS, 10, testutil.BucketID(1)))); status != http.StatusRequestEntityTooLarge {
			t.Fatalf("got %d", status)
		}
	})

	t.Run("shrinking is allowed over the limit", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		id := jid("ab", 41)
		jsave(t, c, jadded(jevSized(id, baseTS, 60)))
		setLimit(t, user.UUID, 10)

		jsave(t, c, jupdated(jevSized(id, baseTS+1, 20)))
		jsave(t, c, jdeleted(id))
		requireCounter(t, user.UUID, 0)
	})

	t.Run("GET /user/quota includes journal bytes", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		jsave(t, c, jadded(jevSized(jid("ab", 51), baseTS, 40)))
		if got := getQuota(t, c); got.Used != 40 {
			t.Fatalf("got %+v", got)
		}
	})

	t.Run("an uncounted journal is counted on the first save and by the quota", func(t *testing.T) {
		user := testutil.NewUser(t)
		if _, err := database.DB.Exec("INSERT INTO journal_items (id, owner, data, updated_at) VALUES (?, ?, ?, ?)", jid("ab", 61), user.UUID, []byte("legacy!"), time.UnixMilli(baseTS)); err != nil {
			t.Fatal(err)
		}
		c := testutil.NewClient(t).As(user)
		if got := getQuota(t, c); got.Used != 7 {
			t.Fatalf("got %+v", got)
		}

		jsave(t, c, jadded(jevSized(jid("ab", 62), baseTS, 3)))
		requireCounter(t, user.UUID, 10)
	})
}

func TestReconcileStorageCountsJournalBytes(t *testing.T) {
	testutil.RequireDB(t)
	user := seedStorage(t, 2)
	c := testutil.NewClient(t).As(user)
	jsave(t, c, jadded(jevSized(jid("ab", 1), baseTS, 25)))
	only := testutil.NewUser(t)
	jsave(t, testutil.NewClient(t).As(only), jadded(jevSized(jid("cd", 1), baseTS, 8)))

	if fixed := handlers.ReconcileStorage(context.Background()); fixed != 0 {
		t.Fatalf("fixed %d accurate counters", fixed)
	}

	setCounter(t, user.UUID, fp(10, 10))
	setCounter(t, only.UUID, 0)
	if fixed := handlers.ReconcileStorage(context.Background()); fixed != 2 {
		t.Fatalf("fixed %d", fixed)
	}
	requireCounter(t, user.UUID, fp(10, 10)+25)
	requireCounter(t, only.UUID, 8)
}

func TestJournalSaveReplicatesOverTheStream(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	conn, hello := openStream(t, testutil.NewClient(t).As(user))
	a, b, gone := jid("ab", 1), jid("ab", 2), jid("cd", 3)
	jsave(t, c, jadded(jev(gone, baseTS)))
	readMessage(t, conn)

	status, _ := testutil.Call[any](c, "POST", "/journal/save?c=abcdef", []handlers.JournalChange{
		jadded(jev(b, baseTS+2)), jadded(jev(a, baseTS+1)), jdeleted(gone),
	})
	if status != http.StatusOK {
		t.Fatalf("save: %d", status)
	}

	got := readMessage(t, conn)
	want := []stream.Change{
		{Type: "deleted", ID: gone},
		{Type: "added", ID: a, Data: jev(a, 0).Data, UpdatedAt: baseTS + 1},
		{Type: "added", ID: b, Data: jev(b, 0).Data, UpdatedAt: baseTS + 2},
	}
	if got.Type != "journal" || got.OriginClientID != "abcdef" || got.Seq != hello.Seq+2 {
		t.Fatalf("got %+v", got)
	}
	if !slices.Equal(got.Changes, want) {
		t.Fatalf("got %+v, want %+v", got.Changes, want)
	}
}

func TestJournalStreamMessageDropsChangesWhenLarge(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	conn, _ := openStream(t, c)

	var changes []handlers.JournalChange
	for i := range constants.MaxStreamPayloadBytes/9000 + 1 {
		changes = append(changes, jadded(jevSized(jid("ab", i), baseTS, 9000)))
	}
	if status, _ := testutil.Call[any](c, "POST", "/journal/save?c=abcdef", changes); status != http.StatusOK {
		t.Fatalf("save: %d", status)
	}

	if got := readMessage(t, conn); got.Type != "journal" || got.OriginClientID != "abcdef" || got.Changes != nil {
		t.Fatalf("got %+v", got)
	}
}

func TestJournalStreamReplicatesOnlyTheFinalStateOfEachItem(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	conn, _ := openStream(t, c)
	id := jid("ab", 1)

	jsave(t, c, jadded(jev(id, baseTS)), jdeleted(id))
	if got := readMessage(t, conn); !slices.Equal(got.Changes, []stream.Change{{Type: "deleted", ID: id}}) {
		t.Fatalf("created then deleted: got %+v", got.Changes)
	}

	jsave(t, c, jdeleted(id), jadded(jev(id, baseTS+1)))
	if got := readMessage(t, conn); len(got.Changes) != 1 || got.Changes[0].Type != "added" || got.Changes[0].UpdatedAt != baseTS+1 {
		t.Fatalf("deleted then created: got %+v", got.Changes)
	}

	jsave(t, c, jdeleted(strings.ToUpper(id)))
	if got := readMessage(t, conn); !slices.Equal(got.Changes, []stream.Change{{Type: "deleted", ID: id}}) {
		t.Fatalf("uppercase delete: got %+v", got.Changes)
	}
}

func TestJournalStreamSkipsWritesThatLoseNewerWins(t *testing.T) {
	testutil.RequireDB(t)
	owner, other := testutil.NewUser(t), testutil.NewUser(t)
	c := testutil.NewClient(t).As(owner)
	ownerConn, _ := openStream(t, c)
	otherConn, _ := openStream(t, testutil.NewClient(t).As(other))
	stale, equal, fresh, foreign := jid("ab", 1), jid("ab", 2), jid("ab", 3), jid("ab", 4)
	jsave(t, c, jadded(jev(stale, baseTS+5)), jadded(jev(equal, baseTS)), jadded(jev(foreign, baseTS)))
	readMessage(t, ownerConn)

	jsave(t, c, jupdated(jev(stale, baseTS)), jupdated(jev(equal, baseTS)), jadded(jev(fresh, baseTS)))
	got := readMessage(t, ownerConn)
	ids := []string{}
	for _, change := range got.Changes {
		ids = append(ids, change.ID)
	}
	if want := []string{equal, fresh}; !slices.Equal(ids, want) {
		t.Fatalf("published %v, want %v", ids, want)
	}

	jsave(t, testutil.NewClient(t).As(other), jupdated(jevSized(foreign, baseTS+100, 7)))
	if got := readMessage(t, otherConn); len(got.Changes) != 0 {
		t.Fatalf("foreign write published %+v", got.Changes)
	}
}

func TestJournalRejectedSaveIsNotPublished(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	conn, _ := openStream(t, c)

	if status := jsaveStatus(c, handlers.JournalChange{Type: "deleted", ID: "nope"}); status != http.StatusBadRequest {
		t.Fatalf("got %d", status)
	}
	jsave(t, c, jadded(jev(jid("ab", 1), baseTS)))

	if got := readMessage(t, conn); got.Type != "journal" || len(got.Changes) != 1 {
		t.Fatalf("got %+v", got)
	}
}

func TestJournalConcurrentSavesOfOneOwner(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	const writers, rounds = 8, 15
	var wg sync.WaitGroup
	failed := make(chan int, writers*rounds*2)
	for w := range writers {
		wg.Go(func() {
			for r := range rounds {
				id, other := jid("ab", w*100+r), jid("cd", w*100+r)
				if status := jsaveStatus(testutil.NewClient(t).As(user), jadded(jevSized(id, baseTS, 20)), jadded(jevSized(other, baseTS, 5))); status != http.StatusOK {
					failed <- status
				}
				if status := jsaveStatus(testutil.NewClient(t).As(user), jupdated(jevSized(id, baseTS+1, 30)), jdeleted(other)); status != http.StatusOK {
					failed <- status
				}
			}
		})
	}
	wg.Wait()
	close(failed)
	for status := range failed {
		t.Fatalf("a save failed with %d", status)
	}

	if want := int64(writers * rounds * 30); jstored(t, user.UUID) != want {
		t.Fatalf("stored %d, want %d", jstored(t, user.UUID), want)
	}
	requireCounter(t, user.UUID, int64(writers*rounds*30))
}

func TestJournalItemsGoWithTheUser(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	jsave(t, testutil.NewClient(t).As(user), jadded(jev(jid("ab", 1), baseTS)))

	if _, err := database.DB.Exec("DELETE FROM users WHERE uuid = ?", user.UUID); err != nil {
		t.Fatal(err)
	}
	if n := count(t, "SELECT COUNT(*) FROM journal_items WHERE owner = ?", user.UUID); n != 0 {
		t.Fatalf("%d rows left", n)
	}
}
