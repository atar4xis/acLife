package handlers_test

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/handlers"
	"acLife/internal/testutil"
	"acLife/types"
)

const baseTS = int64(1790000000000)

func ev(id string, ts int64, buckets ...string) types.EncryptedEvent {
	return types.EncryptedEvent{
		ID:        id,
		Data:      base64.StdEncoding.EncodeToString([]byte("data-" + id)),
		UpdatedAt: ts,
		Buckets:   buckets,
	}
}

func added(e types.EncryptedEvent) handlers.EventChange {
	return handlers.EventChange{Type: "added", Event: e}
}

func updated(e types.EncryptedEvent) handlers.EventChange {
	return handlers.EventChange{Type: "updated", Event: e}
}

func deleted(id string) handlers.EventChange {
	return handlers.EventChange{Type: "deleted", ID: id}
}

func save(c *testutil.Client, changes ...handlers.EventChange) int {
	status, _ := testutil.Call[any](c, "POST", "/calendar/events/save", changes)
	return status
}

func mustSave(t *testing.T, c *testutil.Client, changes ...handlers.EventChange) {
	t.Helper()
	if status := save(c, changes...); status != http.StatusOK {
		t.Fatalf("save: got %d", status)
	}
}

func syncDiff(t *testing.T, c *testutil.Client, req types.EventSyncRequest) types.EventSyncResponse {
	t.Helper()

	status, reply := testutil.Call[types.EventSyncResponse](c, "POST", "/calendar/events/sync", req)
	if status != http.StatusOK {
		t.Fatalf("sync: got %d %+v", status, reply)
	}
	return reply.Data
}

func syncHashes(c *testutil.Client, hashes map[string]string) (int, []string) {
	status, reply := testutil.Call[types.EventHashResponse](c, "POST", "/calendar/events/sync", types.EventSyncRequest{Hashes: hashes})
	return status, reply.Data.Mismatched
}

func cached(id string, ts int64) types.CachedEvent {
	return types.CachedEvent{ID: testutil.UUIDToBase64(id), Timestamp: ts}
}

func eventIDs(events []types.EncryptedEvent) []string {
	ids := make([]string, 0, len(events))
	for _, e := range events {
		ids = append(ids, e.ID)
	}
	slices.Sort(ids)
	return ids
}

func lineFor(id string, ts int64) string {
	return fmt.Sprintf("%s:%d", id, ts)
}

func insertEvents(t *testing.T, owner string, ids ...string) {
	t.Helper()

	values := make([]string, 0, len(ids))
	args := make([]any, 0, len(ids)*4)
	for _, id := range ids {
		values = append(values, "(?, ?, ?, ?)")
		args = append(args, id, owner, []byte("legacy"), time.UnixMilli(baseTS))
	}
	if _, err := database.DB.Exec("INSERT INTO calendar_events (id, owner, data, updated_at) VALUES "+strings.Join(values, ","), args...); err != nil {
		t.Fatal(err)
	}
}

func bucketIDsOf(t *testing.T, eventID string) []string {
	t.Helper()

	rows, err := database.DB.Query("SELECT bucket_id FROM calendar_event_buckets WHERE event_id = ?", eventID)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()

	var out []string
	for rows.Next() {
		var b []byte
		if err := rows.Scan(&b); err != nil {
			t.Fatal(err)
		}
		out = append(out, base64.StdEncoding.EncodeToString(b))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	slices.Sort(out)
	return out
}

func TestSaveStoresAddedEvent(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	id := testutil.NewUUID()
	b1, b2 := testutil.BucketID(1), testutil.BucketID(2)

	mustSave(t, c, added(ev(id, baseTS, b1, b2)))

	var data []byte
	var updatedAt time.Time
	if err := database.DB.QueryRow("SELECT data, updated_at FROM calendar_events WHERE id = ? AND owner = ?", id, user.UUID).Scan(&data, &updatedAt); err != nil {
		t.Fatal(err)
	}
	if string(data) != "data-"+id || updatedAt.UnixMilli() != baseTS {
		t.Fatalf("got %q at %d", data, updatedAt.UnixMilli())
	}
	if got := bucketIDsOf(t, id); !slices.Equal(got, []string{b1, b2}) {
		t.Fatalf("buckets %v", got)
	}
}

func TestSaveUpdateReplacesDataTimestampAndBuckets(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	id := testutil.NewUUID()
	b1, b2, b3 := testutil.BucketID(1), testutil.BucketID(2), testutil.BucketID(3)

	mustSave(t, c, added(ev(id, baseTS, b1, b2)))

	next := ev(id, baseTS+5000, b2, b3)
	next.Data = base64.StdEncoding.EncodeToString([]byte("v2"))
	mustSave(t, c, updated(next))

	var data []byte
	var updatedAt time.Time
	if err := database.DB.QueryRow("SELECT data, updated_at FROM calendar_events WHERE id = ?", id).Scan(&data, &updatedAt); err != nil {
		t.Fatal(err)
	}
	if string(data) != "v2" || updatedAt.UnixMilli() != baseTS+5000 {
		t.Fatalf("got %q at %d", data, updatedAt.UnixMilli())
	}
	if got := bucketIDsOf(t, id); !slices.Equal(got, []string{b2, b3}) {
		t.Fatalf("buckets %v", got)
	}
}

func TestSaveDeleteRemovesEventAndBuckets(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	keep, drop := testutil.NewUUID(), testutil.NewUUID()

	mustSave(t, c, added(ev(keep, baseTS, testutil.BucketID(1))), added(ev(drop, baseTS, testutil.BucketID(1))))
	mustSave(t, c, deleted(drop))

	if n := count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", drop); n != 0 {
		t.Fatalf("deleted event remains")
	}
	if n := count(t, "SELECT COUNT(*) FROM calendar_event_buckets WHERE event_id = ?", drop); n != 0 {
		t.Fatalf("deleted event buckets remain")
	}
	if n := count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", keep); n != 1 {
		t.Fatalf("other event was removed")
	}
}

func TestSaveAppliesMixedBatch(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	a, b, d := testutil.NewUUID(), testutil.NewUUID(), testutil.NewUUID()
	bucket := testutil.BucketID(1)

	mustSave(t, c, added(ev(a, baseTS, bucket)), added(ev(b, baseTS, bucket)))
	mustSave(t, c, deleted(a), updated(ev(b, baseTS+1, bucket)), added(ev(d, baseTS, bucket)))

	if n := count(t, "SELECT COUNT(*) FROM calendar_events WHERE owner = ? AND id IN (?, ?)", user.UUID, b, d); n != 2 {
		t.Fatalf("expected b and d, got %d rows", n)
	}
	if n := count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", a); n != 0 {
		t.Fatalf("a remains")
	}
}

func TestSaveLastChangeForAnIDWins(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	id := testutil.NewUUID()
	bucket := testutil.BucketID(1)

	second := ev(id, baseTS+9, bucket)
	second.Data = base64.StdEncoding.EncodeToString([]byte("second"))
	mustSave(t, c, added(ev(id, baseTS, bucket)), updated(second))

	var data []byte
	if err := database.DB.QueryRow("SELECT data FROM calendar_events WHERE id = ?", id).Scan(&data); err != nil {
		t.Fatal(err)
	}
	if string(data) != "second" {
		t.Fatalf("got %q", data)
	}
}

func TestSaveWithNoChangesSucceeds(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	if status := save(c); status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
}

func TestSaveRejectsMalformedBody(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	for name, body := range map[string][]byte{
		"not json":      []byte("nope"),
		"object":        []byte(`{}`),
		"unknown field": []byte(`[{"type":"deleted","id":"x","extra":1}]`),
	} {
		t.Run(name, func(t *testing.T) {
			resp, _ := c.Do("POST", "/calendar/events/save", body)
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("got %d", resp.StatusCode)
			}
		})
	}
}

func TestSaveRejectsInvalidEvents(t *testing.T) {
	testutil.RequireDB(t)

	tooMany := make([]string, constants.MaxEventBuckets+1)
	for i := range tooMany {
		tooMany[i] = testutil.BucketID(byte(i))
	}
	short := base64.StdEncoding.EncodeToString(make([]byte, constants.BucketIDLen-1))
	long := base64.StdEncoding.EncodeToString(make([]byte, constants.BucketIDLen+1))

	oversized := ev("", baseTS, testutil.BucketID(1))
	oversized.Data = base64.StdEncoding.EncodeToString(make([]byte, constants.MaxEventLen+1))

	badData := ev("", baseTS, testutil.BucketID(1))
	badData.Data = "!!!"

	cases := map[string]types.EncryptedEvent{
		"no buckets":                          ev("", baseTS),
		"too many buckets":                    ev("", baseTS, tooMany...),
		"short bucket id":                     ev("", baseTS, short),
		"long bucket id":                      ev("", baseTS, long),
		"bucket not base64":                   ev("", baseTS, "!!!"),
		"one bad bucket":                      ev("", baseTS, testutil.BucketID(1), short),
		"oversized event":                     oversized,
		"data not base64":                     badData,
		"timestamp below 1970-01-01 00:00:01": ev("", constants.MinEventTimestampMs-1, testutil.BucketID(1)),
		"negative timestamp":                  ev("", -5, testutil.BucketID(1)),
		"timestamp past 2038":                 ev("", constants.MaxEventTimestampMs+1, testutil.BucketID(1)),
		"huge timestamp":                      ev("", 1<<60, testutil.BucketID(1)),
		"id not a uuid":                       ev("hello", baseTS, testutil.BucketID(1)),
		"id too long":                         ev(strings.Repeat("a", 40), baseTS, testutil.BucketID(1)),
		"id empty":                            ev(" ", baseTS, testutil.BucketID(1)),
		"id with trailing junk":               ev(testutil.NewUUID()+"x", baseTS, testutil.BucketID(1)),
		"id with leading junk":                ev("x"+testutil.NewUUID(), baseTS, testutil.BucketID(1)),
	}
	for name, bad := range cases {
		for _, typ := range []string{"added", "updated"} {
			t.Run(name+" "+typ, func(t *testing.T) {
				user := testutil.NewUser(t)
				c := testutil.NewClient(t).As(user)
				if bad.ID == "" {
					bad.ID = testutil.NewUUID()
				}

				if status := save(c, handlers.EventChange{Type: typ, Event: bad}); status != http.StatusBadRequest {
					t.Fatalf("got %d", status)
				}
				if n := count(t, "SELECT COUNT(*) FROM calendar_events WHERE owner = ?", user.UUID); n != 0 {
					t.Fatalf("%d events stored", n)
				}
			})
		}
	}
}

func TestSaveRejectsUnknownChangeType(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)

	status := save(c, handlers.EventChange{Type: "bogus", Event: ev(testutil.NewUUID(), baseTS, testutil.BucketID(1))})
	if status != http.StatusBadRequest {
		t.Fatalf("got %d", status)
	}
}

func TestSaveAcceptsUppercaseUUID(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	mustSave(t, c, added(ev(strings.ToUpper(testutil.NewUUID()), baseTS, testutil.BucketID(1))))
}

func TestSaveAcceptsTimestampsAtTheLimits(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	bucket := testutil.BucketID(1)

	mustSave(t, c, added(ev(testutil.NewUUID(), constants.MinEventTimestampMs, bucket)), added(ev(testutil.NewUUID(), constants.MaxEventTimestampMs, bucket)))
}

func TestSaveReaddedEventReplacesBuckets(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	id := testutil.NewUUID()
	b1, b2 := testutil.BucketID(1), testutil.BucketID(2)

	mustSave(t, c, added(ev(id, baseTS, b1)))
	mustSave(t, c, added(ev(id, baseTS+1, b2)))

	if got := bucketIDsOf(t, id); !slices.Equal(got, []string{b2}) {
		t.Fatalf("buckets %v", got)
	}
}

func TestSaveAcceptsEventsAtTheLimits(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)

	maxBuckets := make([]string, constants.MaxEventBuckets)
	for i := range maxBuckets {
		maxBuckets[i] = testutil.BucketID(byte(i))
	}
	atLimit := ev(testutil.NewUUID(), baseTS, maxBuckets...)
	atLimit.Data = base64.StdEncoding.EncodeToString(make([]byte, constants.MaxEventLen))

	mustSave(t, c, added(atLimit))

	if got := bucketIDsOf(t, atLimit.ID); len(got) != constants.MaxEventBuckets {
		t.Fatalf("got %d buckets", len(got))
	}
}

func TestSaveIsAtomicWhenOneEventIsInvalid(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	good, bad, existing := testutil.NewUUID(), testutil.NewUUID(), testutil.NewUUID()

	mustSave(t, c, added(ev(existing, baseTS, testutil.BucketID(1))))

	status := save(c, added(ev(good, baseTS, testutil.BucketID(1))), deleted(existing), added(ev(bad, baseTS)))
	if status != http.StatusBadRequest {
		t.Fatalf("got %d", status)
	}
	if n := count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", good); n != 0 {
		t.Fatal("valid event in a rejected batch was stored")
	}
	if n := count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", existing); n != 1 {
		t.Fatal("delete in a rejected batch was applied")
	}
}

func TestSaveCannotModifyOtherUsersEvents(t *testing.T) {
	testutil.RequireDB(t)
	b1, b9 := testutil.BucketID(1), testutil.BucketID(9)

	cases := map[string]func(id string) handlers.EventChange{
		"updated": func(id string) handlers.EventChange { return updated(hijack(id, b9)) },
		"added":   func(id string) handlers.EventChange { return added(hijack(id, b9)) },
		"deleted": deleted,
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			owner, attacker := testutil.NewUser(t), testutil.NewUser(t)
			srv := testutil.NewClient(t)
			id := testutil.NewUUID()

			mustSave(t, srv.As(owner), added(ev(id, baseTS, b1)))
			save(srv.As(attacker), change(id))

			var data []byte
			var ownerUUID string
			var updatedAt time.Time
			if err := database.DB.QueryRow("SELECT data, owner, updated_at FROM calendar_events WHERE id = ?", id).Scan(&data, &ownerUUID, &updatedAt); err != nil {
				t.Fatal(err)
			}
			if string(data) != "data-"+id || ownerUUID != owner.UUID || updatedAt.UnixMilli() != baseTS {
				t.Fatalf("event changed: %q owner=%s ts=%d", data, ownerUUID, updatedAt.UnixMilli())
			}
			if got := bucketIDsOf(t, id); !slices.Equal(got, []string{b1}) {
				t.Fatalf("buckets changed: %v", got)
			}
		})
	}
}

func hijack(id string, buckets ...string) types.EncryptedEvent {
	e := ev(id, baseTS+1, buckets...)
	e.Data = base64.StdEncoding.EncodeToString([]byte("hijacked"))
	return e
}

func TestSyncNeverReturnsOtherUsersEvents(t *testing.T) {
	testutil.RequireDB(t)
	owner, other := testutil.NewUser(t), testutil.NewUser(t)
	srv := testutil.NewClient(t)
	id := testutil.NewUUID()
	bucket := testutil.BucketID(1)

	mustSave(t, srv.As(owner), added(ev(id, baseTS, bucket)))
	insertEvents(t, owner.UUID, testutil.NewUUID())

	t.Run("bucket sync", func(t *testing.T) {
		got := syncDiff(t, srv.As(other), types.EventSyncRequest{Buckets: []string{bucket}})
		if len(got.Added)+len(got.Updated) != 0 {
			t.Fatalf("leaked %+v", got)
		}
	})

	t.Run("hash sync only counts own events", func(t *testing.T) {
		_, mismatched := syncHashes(srv.As(other), map[string]string{bucket: handlers.BucketHash(nil)})
		if len(mismatched) != 0 {
			t.Fatalf("other user's events counted: %v", mismatched)
		}
	})

	t.Run("does not report other users events as deleted", func(t *testing.T) {
		got := syncDiff(t, srv.As(owner), types.EventSyncRequest{Events: []types.CachedEvent{cached(id, baseTS)}, Buckets: []string{bucket}})
		if len(got.Deleted) != 0 {
			t.Fatalf("got %+v", got)
		}
	})
}

func TestSyncDiffFull(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	unchanged, stale, fresh, gone := testutil.NewUUID(), testutil.NewUUID(), testutil.NewUUID(), testutil.NewUUID()
	bucket := testutil.BucketID(1)

	mustSave(t, c,
		added(ev(unchanged, baseTS, bucket)),
		added(ev(stale, baseTS+10, bucket)),
		added(ev(fresh, baseTS, bucket)),
	)

	got := syncDiff(t, c, types.EventSyncRequest{
		Events: []types.CachedEvent{
			cached(unchanged, baseTS),
			cached(stale, baseTS),
			cached(gone, baseTS),
		},
		Buckets: []string{bucket},
	})

	if ids := eventIDs(got.Added); !slices.Equal(ids, []string{fresh}) {
		t.Fatalf("added %v", ids)
	}
	if ids := eventIDs(got.Updated); !slices.Equal(ids, []string{stale}) {
		t.Fatalf("updated %v", ids)
	}
	if !slices.Equal(got.Deleted, []string{gone}) {
		t.Fatalf("deleted %v", got.Deleted)
	}
	if got.Updated[0].UpdatedAt != baseTS+10 {
		t.Fatalf("updatedAt %d", got.Updated[0].UpdatedAt)
	}
	if data, _ := base64.StdEncoding.DecodeString(got.Added[0].Data); string(data) != "data-"+fresh {
		t.Fatalf("data %q", data)
	}
}

func TestSyncDiffDoesNotReturnEventsOlderOnServerAsUpdated(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	id := testutil.NewUUID()

	mustSave(t, c, added(ev(id, baseTS, testutil.BucketID(1))))

	got := syncDiff(t, c, types.EventSyncRequest{Events: []types.CachedEvent{cached(id, baseTS+100)}, Buckets: []string{testutil.BucketID(1)}})
	if len(got.Updated)+len(got.Added)+len(got.Deleted) != 0 {
		t.Fatalf("got %+v", got)
	}
}

func TestSyncDiffRestrictsToRequestedBuckets(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	inA, inB, inBoth, outside := testutil.NewUUID(), testutil.NewUUID(), testutil.NewUUID(), testutil.NewUUID()
	a, b, other := testutil.BucketID(1), testutil.BucketID(2), testutil.BucketID(3)

	mustSave(t, c,
		added(ev(inA, baseTS, a)),
		added(ev(inB, baseTS, b)),
		added(ev(inBoth, baseTS, a, b)),
		added(ev(outside, baseTS, other)),
	)

	got := syncDiff(t, c, types.EventSyncRequest{Buckets: []string{a, b}})

	want := []string{inA, inB, inBoth}
	slices.Sort(want)
	if ids := eventIDs(got.Added); !slices.Equal(ids, want) {
		t.Fatalf("added %v, want %v", ids, want)
	}
}

func TestSyncDiffReportsCachedEventsOutsideBucketsAsDeleted(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	outside := testutil.NewUUID()

	mustSave(t, c, added(ev(outside, baseTS, testutil.BucketID(3))))

	got := syncDiff(t, c, types.EventSyncRequest{
		Events:  []types.CachedEvent{cached(outside, baseTS)},
		Buckets: []string{testutil.BucketID(1)},
	})
	if !slices.Equal(got.Deleted, []string{outside}) {
		t.Fatalf("deleted %v", got.Deleted)
	}
}

func TestSyncDiffRejectsInvalidBuckets(t *testing.T) {
	testutil.RequireDB(t)

	tooMany := make([]string, constants.MaxSyncBuckets+1)
	for i := range tooMany {
		tooMany[i] = testutil.BucketID(byte(i))
	}

	cases := map[string][]string{
		"missing":      nil,
		"empty list":   {},
		"too many":     tooMany,
		"not base64":   {"!!!"},
		"wrong length": {base64.StdEncoding.EncodeToString([]byte("short"))},
	}
	for name, buckets := range cases {
		t.Run(name, func(t *testing.T) {
			c := testutil.NewClient(t).As(testutil.NewUser(t))
			status, _ := testutil.Call[any](c, "POST", "/calendar/events/sync", types.EventSyncRequest{Buckets: buckets})
			if status != http.StatusBadRequest {
				t.Fatalf("got %d", status)
			}
		})
	}
}

func TestSyncDiffAcceptsMaxBuckets(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	buckets := make([]string, constants.MaxSyncBuckets)
	for i := range buckets {
		buckets[i] = testutil.BucketID(byte(i))
	}
	syncDiff(t, c, types.EventSyncRequest{Buckets: buckets})
}

func TestSyncHashes(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	a, b := testutil.NewUUID(), testutil.NewUUID()
	b1, b2 := testutil.BucketID(1), testutil.BucketID(2)

	mustSave(t, c, added(ev(a, baseTS, b1)), added(ev(b, baseTS+1, b1, b2)))

	t.Run("matching hashes report nothing", func(t *testing.T) {
		status, mismatched := syncHashes(c, map[string]string{
			b1: handlers.BucketHash([]string{lineFor(a, baseTS), lineFor(b, baseTS+1)}),
			b2: handlers.BucketHash([]string{lineFor(b, baseTS+1)}),
		})
		if status != http.StatusOK || len(mismatched) != 0 {
			t.Fatalf("got %d %v", status, mismatched)
		}
	})

	t.Run("only differing buckets are reported", func(t *testing.T) {
		_, mismatched := syncHashes(c, map[string]string{
			b1: handlers.BucketHash([]string{lineFor(a, baseTS), lineFor(b, baseTS+1)}),
			b2: handlers.BucketHash(nil),
		})
		if !slices.Equal(mismatched, []string{b2}) {
			t.Fatalf("got %v", mismatched)
		}
	})

	t.Run("stale timestamp mismatches", func(t *testing.T) {
		_, mismatched := syncHashes(c, map[string]string{
			b1: handlers.BucketHash([]string{lineFor(a, baseTS-1), lineFor(b, baseTS+1)}),
		})
		if !slices.Equal(mismatched, []string{b1}) {
			t.Fatalf("got %v", mismatched)
		}
	})

	t.Run("empty bucket with empty hash matches", func(t *testing.T) {
		_, mismatched := syncHashes(c, map[string]string{testutil.BucketID(7): handlers.BucketHash(nil)})
		if len(mismatched) != 0 {
			t.Fatalf("got %v", mismatched)
		}
	})

	t.Run("empty bucket with non-empty client hash mismatches", func(t *testing.T) {
		unknown := testutil.BucketID(7)
		_, mismatched := syncHashes(c, map[string]string{unknown: handlers.BucketHash([]string{lineFor(a, baseTS)})})
		if !slices.Equal(mismatched, []string{unknown}) {
			t.Fatalf("got %v", mismatched)
		}
	})

	t.Run("a deleted event changes the hash", func(t *testing.T) {
		mustSave(t, c, deleted(b))
		_, mismatched := syncHashes(c, map[string]string{
			b1: handlers.BucketHash([]string{lineFor(a, baseTS), lineFor(b, baseTS+1)}),
		})
		if !slices.Equal(mismatched, []string{b1}) {
			t.Fatalf("got %v", mismatched)
		}
	})
}

func TestSyncHashesRejectsInvalidRequests(t *testing.T) {
	testutil.RequireDB(t)

	tooMany := make(map[string]string, constants.MaxSyncBuckets+1)
	for i := range constants.MaxSyncBuckets + 1 {
		tooMany[testutil.BucketID(byte(i))] = "x"
	}

	cases := map[string]map[string]string{
		"empty":        {},
		"too many":     tooMany,
		"not base64":   {"!!!": "x"},
		"wrong length": {base64.StdEncoding.EncodeToString([]byte("short")): "x"},
	}
	for name, hashes := range cases {
		t.Run(name, func(t *testing.T) {
			c := testutil.NewClient(t).As(testutil.NewUser(t))
			if status, _ := syncHashes(c, hashes); status != http.StatusBadRequest {
				t.Fatalf("got %d", status)
			}
		})
	}
}

func TestSyncHashesAcceptsMaxBuckets(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	hashes := make(map[string]string, constants.MaxSyncBuckets)
	for i := range constants.MaxSyncBuckets {
		hashes[testutil.BucketID(byte(i))] = handlers.BucketHash(nil)
	}
	if status, mismatched := syncHashes(c, hashes); status != http.StatusOK || len(mismatched) != 0 {
		t.Fatalf("got %d %v", status, mismatched)
	}
}

func TestDeletingUserCascadesToEvents(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	id := testutil.NewUUID()

	mustSave(t, c, added(ev(id, baseTS, testutil.BucketID(1))))
	if _, err := database.DB.Exec("DELETE FROM users WHERE uuid = ?", user.UUID); err != nil {
		t.Fatal(err)
	}

	if n := count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", id); n != 0 {
		t.Fatal("events remain")
	}
	if n := count(t, "SELECT COUNT(*) FROM calendar_event_buckets WHERE event_id = ?", id); n != 0 {
		t.Fatal("buckets remain")
	}
}

func TestSaveBatchFollowsListOrderForOneEvent(t *testing.T) {
	testutil.RequireDB(t)
	bucket := testutil.BucketID(1)

	t.Run("created then deleted leaves nothing", func(t *testing.T) {
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		id := testutil.NewUUID()

		mustSave(t, c, added(ev(id, baseTS, bucket)), deleted(id))

		if n := count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", id); n != 0 {
			t.Fatal("event survived its own deletion")
		}
		if n := count(t, "SELECT COUNT(*) FROM calendar_event_buckets WHERE event_id = ?", id); n != 0 {
			t.Fatal("buckets survived its own deletion")
		}
	})

	t.Run("updated then deleted removes the stored event", func(t *testing.T) {
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		id := testutil.NewUUID()
		mustSave(t, c, added(ev(id, baseTS, bucket)))

		mustSave(t, c, updated(ev(id, baseTS+1, bucket)), deleted(id))

		if n := count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", id); n != 0 {
			t.Fatal("event survived")
		}
	})

	t.Run("deleted then created again keeps the new version", func(t *testing.T) {
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		id := testutil.NewUUID()
		mustSave(t, c, added(ev(id, baseTS, bucket)))

		mustSave(t, c, deleted(id), added(ev(id, baseTS+5, bucket)))

		var updatedAt time.Time
		if err := database.DB.QueryRow("SELECT updated_at FROM calendar_events WHERE id = ?", id).Scan(&updatedAt); err != nil {
			t.Fatal(err)
		}
		if updatedAt.UnixMilli() != baseTS+5 {
			t.Fatalf("updated_at %d", updatedAt.UnixMilli())
		}
	})

	t.Run("deleting one event does not affect another in the batch", func(t *testing.T) {
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		a, b := testutil.NewUUID(), testutil.NewUUID()

		mustSave(t, c, added(ev(a, baseTS, bucket)), added(ev(b, baseTS, bucket)), deleted(a))

		if count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", a) != 0 || count(t, "SELECT COUNT(*) FROM calendar_events WHERE id = ?", b) != 1 {
			t.Fatal("wrong events remain")
		}
	})
}
