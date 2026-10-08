package handlers_test

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"
	"sync"
	"testing"

	"acLife/constants"
	"acLife/database"
	"acLife/handlers"
	"acLife/internal/testutil"
	"acLife/types"
)

func evSized(id string, ts int64, size int, buckets ...string) types.EncryptedEvent {
	e := ev(id, ts, buckets...)
	e.Data = base64.StdEncoding.EncodeToString([]byte(strings.Repeat("x", size)))
	return e
}

func counter(t *testing.T, owner string) int64 {
	t.Helper()

	var used int64
	if err := database.DB.QueryRow("SELECT event_bytes FROM user_storage WHERE owner = ?", owner).Scan(&used); err != nil {
		t.Fatalf("read counter: %v", err)
	}
	return used
}

func stored(t *testing.T, owner string) int64 {
	t.Helper()

	var data, bucketRows int64
	if err := database.DB.QueryRow("SELECT COALESCE(SUM(OCTET_LENGTH(data)), 0) FROM calendar_events WHERE owner = ?", owner).Scan(&data); err != nil {
		t.Fatalf("sum stored: %v", err)
	}
	if err := database.DB.QueryRow("SELECT COUNT(*) FROM calendar_event_buckets ceb JOIN calendar_events ce ON ce.id = ceb.event_id WHERE ce.owner = ?", owner).Scan(&bucketRows); err != nil {
		t.Fatalf("count bucket rows: %v", err)
	}
	return data + bucketRows*constants.BucketRowBytes
}

func fp(sizes ...int) int64 {
	var total int64
	for _, size := range sizes {
		total += int64(size) + constants.BucketRowBytes
	}
	return total
}

func addBucketRows(t *testing.T, eventID string, n int) {
	t.Helper()

	for i := range n {
		bucket, err := base64.StdEncoding.DecodeString(testutil.BucketID(byte(100 + i)))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := database.DB.Exec("INSERT INTO calendar_event_buckets (event_id, bucket_id) VALUES (?, ?)", eventID, bucket); err != nil {
			t.Fatal(err)
		}
	}
}

func requireCounter(t *testing.T, owner string, want int64) {
	t.Helper()

	if got := counter(t, owner); got != want {
		t.Fatalf("counter %d bytes, want %d", got, want)
	}
	if got := stored(t, owner); got != want {
		t.Fatalf("stored %d bytes, counter claims %d", got, want)
	}
}

func setLimit(t *testing.T, owner string, limit any) {
	t.Helper()

	if _, err := database.DB.Exec("INSERT INTO user_storage (owner, max_bytes) VALUES (?, ?) ON DUPLICATE KEY UPDATE max_bytes = VALUES(max_bytes)", owner, limit); err != nil {
		t.Fatal(err)
	}
}

func TestStorageCountersTrackSaves(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	a, b, d := testutil.NewUUID(), testutil.NewUUID(), testutil.NewUUID()
	bucket := testutil.BucketID(1)

	mustSave(t, c, added(evSized(a, baseTS, 100, bucket)), added(evSized(b, baseTS, 50, bucket)))
	requireCounter(t, user.UUID, fp(100, 50))

	t.Run("an update that grows the event adds the difference", func(t *testing.T) {
		mustSave(t, c, updated(evSized(a, baseTS+1, 130, bucket)))
		requireCounter(t, user.UUID, fp(130, 50))
	})
	t.Run("an update that shrinks the event subtracts the difference", func(t *testing.T) {
		mustSave(t, c, updated(evSized(a, baseTS+2, 20, bucket)))
		requireCounter(t, user.UUID, fp(20, 50))
	})
	t.Run("adding an event that exists replaces it", func(t *testing.T) {
		mustSave(t, c, added(evSized(b, baseTS+3, 60, bucket)))
		requireCounter(t, user.UUID, fp(20, 60))
	})
	t.Run("repeating a save changes nothing", func(t *testing.T) {
		mustSave(t, c, added(evSized(b, baseTS+3, 60, bucket)), updated(evSized(a, baseTS+2, 20, bucket)))
		requireCounter(t, user.UUID, fp(20, 60))
	})
	t.Run("a mixed batch", func(t *testing.T) {
		mustSave(t, c, deleted(a), added(evSized(d, baseTS, 7, bucket)), updated(evSized(b, baseTS+4, 10, bucket)))
		requireCounter(t, user.UUID, fp(7, 10))
	})
	t.Run("the last change for an id decides", func(t *testing.T) {
		mustSave(t, c, added(evSized(a, baseTS, 5, bucket)), deleted(a))
		requireCounter(t, user.UUID, fp(7, 10))
		mustSave(t, c, deleted(a), added(evSized(a, baseTS, 5, bucket)))
		requireCounter(t, user.UUID, fp(7, 10, 5))
	})
	t.Run("deleting an event that does not exist changes nothing", func(t *testing.T) {
		mustSave(t, c, deleted(testutil.NewUUID()))
		requireCounter(t, user.UUID, fp(7, 10, 5))
	})
	t.Run("deleting everything", func(t *testing.T) {
		mustSave(t, c, deleted(a), deleted(b), deleted(d))
		requireCounter(t, user.UUID, 0)
	})
}

func TestStorageCountsEventsThatPredateTheCounters(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	legacy := testutil.NewUUID()
	insertEvents(t, user.UUID, legacy, testutil.NewUUID(), testutil.NewUUID())
	addBucketRows(t, legacy, 2)
	c := testutil.NewClient(t).As(user)

	mustSave(t, c, added(evSized(testutil.NewUUID(), baseTS, 10, testutil.BucketID(1))))

	requireCounter(t, user.UUID, 3*int64(len("legacy"))+2*constants.BucketRowBytes+fp(10))
}

func TestStorageIgnoresEventsOfOtherUsers(t *testing.T) {
	testutil.RequireDB(t)
	owner, intruder := testutil.NewUser(t), testutil.NewUser(t)
	oc, ic := testutil.NewClient(t).As(owner), testutil.NewClient(t).As(intruder)
	id := testutil.NewUUID()
	bucket := testutil.BucketID(1)

	mustSave(t, oc, added(evSized(id, baseTS, 40, bucket)))
	mustSave(t, ic, added(evSized(testutil.NewUUID(), baseTS, 3, bucket)))
	other := testutil.BucketID(2)

	t.Run("overwriting another user's event", func(t *testing.T) {
		mustSave(t, ic, added(evSized(id, baseTS+1, 90, bucket, other)), updated(evSized(id, baseTS+2, 90, bucket, other)))
		requireCounter(t, owner.UUID, fp(40))
		requireCounter(t, intruder.UUID, fp(3))
	})
	t.Run("deleting another user's event", func(t *testing.T) {
		mustSave(t, ic, deleted(id))
		requireCounter(t, owner.UUID, fp(40))
		requireCounter(t, intruder.UUID, fp(3))
	})
}

func TestStorageCountsAnEventOnceWhateverTheIDCase(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	id := testutil.NewUUID()
	upper := strings.ToUpper(id)
	bucket := testutil.BucketID(1)

	mustSave(t, c, added(evSized(upper, baseTS, 30, bucket)), updated(evSized(id, baseTS+1, 30, bucket)))
	requireCounter(t, user.UUID, fp(30))

	mustSave(t, c, updated(evSized(upper, baseTS+2, 12, bucket)))
	requireCounter(t, user.UUID, fp(12))

	mustSave(t, c, deleted(upper))
	requireCounter(t, user.UUID, 0)
}

func TestStorageIsUntouchedByRejectedSaves(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	bucket := testutil.BucketID(1)
	keep := testutil.NewUUID()
	mustSave(t, c, added(evSized(keep, baseTS, 20, bucket)))

	t.Run("an invalid event", func(t *testing.T) {
		bad := evSized(testutil.NewUUID(), baseTS, 5, bucket)
		bad.Data = "not base64!"
		if status := save(c, added(evSized(testutil.NewUUID(), baseTS, 5, bucket)), deleted(keep), added(bad)); status != http.StatusBadRequest {
			t.Fatalf("got %d", status)
		}
		requireCounter(t, user.UUID, fp(20))
	})
	t.Run("over the storage limit", func(t *testing.T) {
		old := constants.MaxUserBytes
		constants.MaxUserBytes = 100
		t.Cleanup(func() { constants.MaxUserBytes = old })

		if status := save(c, deleted(keep), added(evSized(testutil.NewUUID(), baseTS, 45, bucket))); status != http.StatusRequestEntityTooLarge {
			t.Fatalf("got %d", status)
		}
		requireCounter(t, user.UUID, fp(20))
	})
}

func TestStorageLimitsUseTheCounters(t *testing.T) {
	testutil.RequireDB(t)
	old := constants.MaxUserBytes
	constants.MaxUserBytes = fp(60, 40)
	t.Cleanup(func() { constants.MaxUserBytes = old })

	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	bucket := testutil.BucketID(1)
	a, b := testutil.NewUUID(), testutil.NewUUID()

	mustSave(t, c, added(evSized(a, baseTS, 60, bucket)), added(evSized(b, baseTS, 40, bucket)))
	if status := save(c, updated(evSized(b, baseTS+1, 41, bucket))); status != http.StatusRequestEntityTooLarge {
		t.Fatalf("growing past the limit: got %d", status)
	}
	mustSave(t, c, updated(evSized(a, baseTS+1, 10, bucket)), updated(evSized(b, baseTS+1, 90, bucket)))
	requireCounter(t, user.UUID, fp(10, 90))
}

func TestStorageOverTheLimitCanStillShrink(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	bucket := testutil.BucketID(1)
	id := testutil.NewUUID()

	mustSave(t, c, added(evSized(id, baseTS, 100, bucket)))
	setLimit(t, user.UUID, fp(50))

	if status := save(c, updated(evSized(id, baseTS+1, 120, bucket))); status != http.StatusRequestEntityTooLarge {
		t.Fatalf("growing while over the limit: got %d", status)
	}
	mustSave(t, c, updated(evSized(id, baseTS+1, 80, bucket)))
	requireCounter(t, user.UUID, fp(80))
}

func TestStorageStaysAccurateUnderConcurrentSaves(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	bucket := testutil.BucketID(1)
	shared := testutil.NewUUID()

	const writers, rounds = 8, 6
	statuses := make(chan int, writers*rounds*3)
	var wg sync.WaitGroup
	for w := range writers {
		wg.Go(func() {
			c := testutil.NewClient(t).As(user)
			for r := range rounds {
				own := testutil.NewUUID()
				statuses <- save(c, added(evSized(own, baseTS, 10+w, bucket)), added(evSized(shared, baseTS+int64(r), 5+w, bucket)))
				statuses <- save(c, updated(evSized(own, baseTS+1, 20+w, bucket)))
				statuses <- save(c, deleted(own))
			}
		})
	}
	wg.Wait()
	close(statuses)

	for status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
	}
	requireCounter(t, user.UUID, stored(t, user.UUID))
}

func TestStorageFirstSavesRacingOverExistingEvents(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	insertEvents(t, user.UUID, testutil.NewUUID(), testutil.NewUUID())
	bucket := testutil.BucketID(1)

	const writers = 8
	statuses := make([]int, writers)
	var wg sync.WaitGroup
	for i := range writers {
		wg.Go(func() {
			statuses[i] = save(testutil.NewClient(t).As(user), added(evSized(testutil.NewUUID(), baseTS, 4, bucket)))
		})
	}
	wg.Wait()

	for _, status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("statuses %v", statuses)
		}
	}
	requireCounter(t, user.UUID, 2*int64(len("legacy"))+writers*fp(4))
}

func TestStorageRowGoesWithTheUser(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	mustSave(t, testutil.NewClient(t).As(user), added(ev(testutil.NewUUID(), baseTS, testutil.BucketID(1))))

	if _, err := database.DB.Exec("DELETE FROM users WHERE uuid = ?", user.UUID); err != nil {
		t.Fatal(err)
	}
	if n := count(t, "SELECT COUNT(*) FROM user_storage WHERE owner = ?", user.UUID); n != 0 {
		t.Fatalf("%d rows left", n)
	}
}

func seedStorage(t *testing.T, events int) testutil.User {
	t.Helper()

	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	changes := make([]handlers.EventChange, events)
	for i := range changes {
		changes[i] = added(evSized(testutil.NewUUID(), baseTS, 10, testutil.BucketID(1)))
	}
	mustSave(t, c, changes...)
	return user
}

func setCounter(t *testing.T, owner string, used int64) {
	t.Helper()

	if _, err := database.DB.Exec("UPDATE user_storage SET event_bytes = ? WHERE owner = ?", used, owner); err != nil {
		t.Fatal(err)
	}
}

func TestReconcileStorage(t *testing.T) {
	testutil.RequireDB(t)

	t.Run("leaves accurate counters alone", func(t *testing.T) {
		user := seedStorage(t, 3)
		if fixed := handlers.ReconcileStorage(context.Background()); fixed != 0 {
			t.Fatalf("fixed %d", fixed)
		}
		requireCounter(t, user.UUID, fp(10, 10, 10))
	})

	t.Run("corrects counters that drifted", func(t *testing.T) {
		high, low, ok := seedStorage(t, 3), seedStorage(t, 2), seedStorage(t, 1)
		setCounter(t, high.UUID, 5000)
		setCounter(t, low.UUID, 0)

		if fixed := handlers.ReconcileStorage(context.Background()); fixed != 2 {
			t.Fatalf("fixed %d", fixed)
		}
		requireCounter(t, high.UUID, fp(10, 10, 10))
		requireCounter(t, low.UUID, fp(10, 10))
		requireCounter(t, ok.UUID, fp(10))
	})

	t.Run("zeroes the counter of a user without events", func(t *testing.T) {
		user := seedStorage(t, 1)
		if _, err := database.DB.Exec("DELETE FROM calendar_events WHERE owner = ?", user.UUID); err != nil {
			t.Fatal(err)
		}

		if fixed := handlers.ReconcileStorage(context.Background()); fixed != 1 {
			t.Fatalf("fixed %d", fixed)
		}
		requireCounter(t, user.UUID, 0)
	})

	t.Run("counts rows that were never counted", func(t *testing.T) {
		user := seedStorage(t, 2)
		setCounter(t, user.UUID, -1)

		if fixed := handlers.ReconcileStorage(context.Background()); fixed != 1 {
			t.Fatalf("fixed %d", fixed)
		}
		requireCounter(t, user.UUID, fp(10, 10))
	})

	t.Run("covers more users than one batch", func(t *testing.T) {
		users := make([]testutil.User, constants.StorageReconcileBatch*2+5)
		for i := range users {
			users[i] = seedStorage(t, 1)
			setCounter(t, users[i].UUID, 7)
		}

		if fixed := handlers.ReconcileStorage(context.Background()); fixed != len(users) {
			t.Fatalf("fixed %d of %d", fixed, len(users))
		}
		for _, u := range users {
			requireCounter(t, u.UUID, fp(10))
		}
	})

	t.Run("keeps the limit override", func(t *testing.T) {
		user := seedStorage(t, 2)
		setLimit(t, user.UUID, 12345)
		setCounter(t, user.UUID, 9)

		handlers.ReconcileStorage(context.Background())

		var limit int64
		if err := database.DB.QueryRow("SELECT max_bytes FROM user_storage WHERE owner = ?", user.UUID).Scan(&limit); err != nil || limit != 12345 {
			t.Fatalf("limit %d, err %v", limit, err)
		}
	})

	t.Run("keeps counters valid for saves that follow", func(t *testing.T) {
		user := seedStorage(t, 2)
		setCounter(t, user.UUID, 9)
		handlers.ReconcileStorage(context.Background())

		mustSave(t, testutil.NewClient(t).As(user), added(evSized(testutil.NewUUID(), baseTS, 5, testutil.BucketID(1))))
		requireCounter(t, user.UUID, fp(10, 10, 5))
	})
}

func TestFixStorageRechecksUnderTheLock(t *testing.T) {
	testutil.RequireDB(t)
	user := seedStorage(t, 2)

	fixed, err := handlers.FixStorage(context.Background(), user.UUID)
	if err != nil || fixed {
		t.Fatalf("fixed %v, err %v", fixed, err)
	}
	requireCounter(t, user.UUID, fp(10, 10))
}

func TestFixStorageIgnoresAnOwnerWithoutCounter(t *testing.T) {
	testutil.RequireDB(t)

	fixed, err := handlers.FixStorage(context.Background(), testutil.NewUUID())
	if err != nil || fixed {
		t.Fatalf("fixed %v, err %v", fixed, err)
	}
}

func TestStorageLimitOverrides(t *testing.T) {
	testutil.RequireDB(t)
	old := constants.MaxUserBytes
	constants.MaxUserBytes = fp(100)
	t.Cleanup(func() { constants.MaxUserBytes = old })
	bucket := testutil.BucketID(1)

	t.Run("the default applies without an override", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		mustSave(t, c, added(evSized(testutil.NewUUID(), baseTS, 100, bucket)))
		if status := save(c, added(evSized(testutil.NewUUID(), baseTS, 1, bucket))); status != http.StatusRequestEntityTooLarge {
			t.Fatalf("got %d", status)
		}
	})
	t.Run("a higher override raises the limit", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		mustSave(t, c, added(evSized(testutil.NewUUID(), baseTS, 100, bucket)))
		setLimit(t, user.UUID, fp(100, 150))

		mustSave(t, c, added(evSized(testutil.NewUUID(), baseTS, 150, bucket)))
		if status := save(c, added(evSized(testutil.NewUUID(), baseTS, 1, bucket))); status != http.StatusRequestEntityTooLarge {
			t.Fatalf("got %d", status)
		}
		requireCounter(t, user.UUID, fp(100, 150))
	})
	t.Run("a lower override lowers the limit", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		mustSave(t, c, added(evSized(testutil.NewUUID(), baseTS, 10, bucket)))
		setLimit(t, user.UUID, fp(10, 20))

		if status := save(c, added(evSized(testutil.NewUUID(), baseTS, 25, bucket))); status != http.StatusRequestEntityTooLarge {
			t.Fatalf("got %d", status)
		}
		mustSave(t, c, added(evSized(testutil.NewUUID(), baseTS, 20, bucket)))
		requireCounter(t, user.UUID, fp(10, 20))
	})
	t.Run("an override set before the first save applies", func(t *testing.T) {
		user := testutil.NewUser(t)
		insertEvents(t, user.UUID, testutil.NewUUID())
		setLimit(t, user.UUID, int64(len("legacy"))+fp(44))
		c := testutil.NewClient(t).As(user)

		mustSave(t, c, added(evSized(testutil.NewUUID(), baseTS, 44, bucket)))
		if status := save(c, added(evSized(testutil.NewUUID(), baseTS, 1, bucket))); status != http.StatusRequestEntityTooLarge {
			t.Fatalf("got %d", status)
		}
	})
	t.Run("NULL goes back to the default", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		setLimit(t, user.UUID, 10)
		if status := save(c, added(evSized(testutil.NewUUID(), baseTS, 50, bucket))); status != http.StatusRequestEntityTooLarge {
			t.Fatalf("got %d", status)
		}

		setLimit(t, user.UUID, nil)
		mustSave(t, c, added(evSized(testutil.NewUUID(), baseTS, 50, bucket)))
	})
	t.Run("an override of 0 stores nothing", func(t *testing.T) {
		user := testutil.NewUser(t)
		setLimit(t, user.UUID, 0)
		c := testutil.NewClient(t).As(user)
		if status := save(c, added(evSized(testutil.NewUUID(), baseTS, 1, bucket))); status != http.StatusRequestEntityTooLarge {
			t.Fatalf("got %d", status)
		}
	})
	t.Run("deleting works above the limit", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		id := testutil.NewUUID()
		setLimit(t, user.UUID, 1000)
		mustSave(t, c, added(evSized(id, baseTS, 80, bucket)), added(evSized(testutil.NewUUID(), baseTS, 80, bucket)))
		setLimit(t, user.UUID, 10)

		mustSave(t, c, deleted(id))
		requireCounter(t, user.UUID, fp(80))
	})
	t.Run("other users keep the default", func(t *testing.T) {
		limited, other := testutil.NewUser(t), testutil.NewUser(t)
		setLimit(t, limited.UUID, 1)
		mustSave(t, testutil.NewClient(t).As(other), added(evSized(testutil.NewUUID(), baseTS, 90, bucket)))
	})
}

func getQuota(t *testing.T, c *testutil.Client) types.Quota {
	t.Helper()

	status, reply := testutil.Call[types.Quota](c, "GET", "/user/quota", nil)
	if status != http.StatusOK || !reply.Success {
		t.Fatalf("got %d", status)
	}
	return reply.Data
}

func TestGetQuota(t *testing.T) {
	testutil.RequireDB(t)
	old := constants.MaxUserBytes
	constants.MaxUserBytes = 1000
	t.Cleanup(func() { constants.MaxUserBytes = old })
	bucket := testutil.BucketID(1)

	t.Run("requires login", func(t *testing.T) {
		if status, _ := testutil.Call[any](testutil.NewClient(t), "GET", "/user/quota", nil); status != http.StatusUnauthorized {
			t.Fatalf("got %d", status)
		}
	})
	t.Run("a user who never saved uses nothing", func(t *testing.T) {
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		if got := getQuota(t, c); got != (types.Quota{Used: 0, Limit: 1000}) {
			t.Fatalf("got %+v", got)
		}
	})
	t.Run("follows saves and deletes", func(t *testing.T) {
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		id := testutil.NewUUID()
		mustSave(t, c, added(evSized(id, baseTS, 40, bucket)), added(evSized(testutil.NewUUID(), baseTS, 2, bucket)))
		if got := getQuota(t, c); got != (types.Quota{Used: fp(40, 2), Limit: 1000}) {
			t.Fatalf("got %+v", got)
		}

		mustSave(t, c, deleted(id))
		if got := getQuota(t, c); got.Used != fp(2) {
			t.Fatalf("got %+v", got)
		}
	})
	t.Run("counts bucket rows", func(t *testing.T) {
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		mustSave(t, c, added(evSized(testutil.NewUUID(), baseTS, 10, bucket, testutil.BucketID(2), testutil.BucketID(3))))
		if got := getQuota(t, c); got.Used != 10+3*constants.BucketRowBytes {
			t.Fatalf("got %+v", got)
		}
	})
	t.Run("reports the override", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		setLimit(t, user.UUID, 77)
		if got := getQuota(t, c); got.Limit != 77 {
			t.Fatalf("got %+v", got)
		}

		setLimit(t, user.UUID, nil)
		if got := getQuota(t, c); got.Limit != 1000 {
			t.Fatalf("got %+v", got)
		}
	})
	t.Run("counts events stored before the counter existed without creating one", func(t *testing.T) {
		user := testutil.NewUser(t)
		legacy := testutil.NewUUID()
		insertEvents(t, user.UUID, legacy, testutil.NewUUID())
		addBucketRows(t, legacy, 2)
		c := testutil.NewClient(t).As(user)

		if got := getQuota(t, c); got.Used != 2*int64(len("legacy"))+2*constants.BucketRowBytes {
			t.Fatalf("got %+v", got)
		}
		if n := count(t, "SELECT COUNT(*) FROM user_storage WHERE owner = ?", user.UUID); n != 0 {
			t.Fatal("reading the quota created a row")
		}

		setLimit(t, user.UUID, 5)
		if got := getQuota(t, c); got != (types.Quota{Used: 12 + 2*constants.BucketRowBytes, Limit: 5}) {
			t.Fatalf("with an override row but no count: %+v", got)
		}
	})
	t.Run("ignores other users", func(t *testing.T) {
		mustSave(t, testutil.NewClient(t).As(testutil.NewUser(t)), added(evSized(testutil.NewUUID(), baseTS, 500, bucket)))
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		if got := getQuota(t, c); got.Used != 0 {
			t.Fatalf("got %+v", got)
		}
	})
}

func TestStorageCountsBucketRows(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	id := testutil.NewUUID()
	buckets := func(n int) []string {
		out := make([]string, n)
		for i := range out {
			out[i] = testutil.BucketID(byte(i))
		}
		return out
	}
	const rb = int64(constants.BucketRowBytes)

	mustSave(t, c, added(evSized(id, baseTS, 10, buckets(3)...)))
	requireCounter(t, user.UUID, 10+3*rb)

	t.Run("dropping buckets lowers it", func(t *testing.T) {
		mustSave(t, c, updated(evSized(id, baseTS+1, 10, buckets(1)...)))
		requireCounter(t, user.UUID, 10+rb)
	})
	t.Run("adding buckets raises it", func(t *testing.T) {
		mustSave(t, c, updated(evSized(id, baseTS+2, 10, buckets(10)...)))
		requireCounter(t, user.UUID, 10+10*rb)
	})
	t.Run("repeating the save changes nothing", func(t *testing.T) {
		mustSave(t, c, updated(evSized(id, baseTS+2, 10, buckets(10)...)))
		requireCounter(t, user.UUID, 10+10*rb)
	})
	t.Run("deleting the event frees them", func(t *testing.T) {
		mustSave(t, c, deleted(id))
		requireCounter(t, user.UUID, 0)
		if n := count(t, "SELECT COUNT(*) FROM calendar_event_buckets WHERE event_id = ?", id); n != 0 {
			t.Fatalf("%d bucket rows left", n)
		}
	})
}

func TestStorageLimitCountsBucketRows(t *testing.T) {
	testutil.RequireDB(t)
	old := constants.MaxUserBytes
	constants.MaxUserBytes = 500
	t.Cleanup(func() { constants.MaxUserBytes = old })
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	buckets := func(n int) []string {
		out := make([]string, n)
		for i := range out {
			out[i] = testutil.BucketID(byte(i))
		}
		return out
	}

	wide := evSized(testutil.NewUUID(), baseTS, 1, buckets(10)...)
	if status := save(c, added(wide)); status != http.StatusRequestEntityTooLarge {
		t.Fatalf("an event of 1 byte with 10 buckets: got %d", status)
	}
	if n := count(t, "SELECT COUNT(*) FROM calendar_event_buckets WHERE event_id = ?", wide.ID); n != 0 {
		t.Fatalf("%d bucket rows stored", n)
	}

	mustSave(t, c, added(evSized(testutil.NewUUID(), baseTS, 1, buckets(5)...)))
	if status := save(c, added(evSized(testutil.NewUUID(), baseTS, 1, buckets(5)...))); status != http.StatusRequestEntityTooLarge {
		t.Fatalf("second wide event: got %d", status)
	}
	requireCounter(t, user.UUID, 1+5*constants.BucketRowBytes)
}

func TestReconcileStorageCountsBucketRows(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	id := testutil.NewUUID()
	mustSave(t, testutil.NewClient(t).As(user), added(evSized(id, baseTS, 10, testutil.BucketID(1), testutil.BucketID(2), testutil.BucketID(3), testutil.BucketID(4))))
	setCounter(t, user.UUID, 10)

	if fixed := handlers.ReconcileStorage(context.Background()); fixed != 1 {
		t.Fatalf("fixed %d", fixed)
	}
	requireCounter(t, user.UUID, 10+4*constants.BucketRowBytes)

	addBucketRows(t, id, 2)
	if fixed := handlers.ReconcileStorage(context.Background()); fixed != 1 {
		t.Fatalf("fixed %d", fixed)
	}
	requireCounter(t, user.UUID, 10+6*constants.BucketRowBytes)
}
