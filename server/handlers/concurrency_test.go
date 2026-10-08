package handlers_test

import (
	"sync"
	"sync/atomic"
	"testing"

	"acLife/handlers"
	"acLife/internal/testutil"
)

func TestSavesOfDifferentUsersDoNotFailEachOther(t *testing.T) {
	testutil.RequireDB(t)
	const users, rounds = 12, 25
	us := make([]testutil.User, users)
	for i := range us {
		us[i] = testutil.NewUser(t)
	}
	var bad, total atomic.Int64
	var wg sync.WaitGroup
	for _, u := range us {
		wg.Go(func() {
			for range rounds {
				c := testutil.NewClient(t).As(u)
				id1, id2, id3 := testutil.NewUUID(), testutil.NewUUID(), testutil.NewUUID()
				changes := []handlers.EventChange{
					added(ev(id1, baseTS, testutil.BucketID(1), testutil.BucketID(2))),
					added(ev(id2, baseTS, testutil.BucketID(3))),
					added(ev(id3, baseTS, testutil.BucketID(4), testutil.BucketID(5))),
				}
				total.Add(1)
				if save(c, changes...) != 200 {
					bad.Add(1)
				}
				total.Add(1)
				if save(c, updated(ev(id1, baseTS+1, testutil.BucketID(6))), deleted(id2)) != 200 {
					bad.Add(1)
				}
			}
		})
	}
	wg.Wait()
	if bad.Load() != 0 {
		t.Fatalf("%d of %d saves failed", bad.Load(), total.Load())
	}
}

func TestNotificationSyncsOfDifferentUsersDoNotFailEachOther(t *testing.T) {
	testutil.RequireDB(t)
	const users, rounds = 12, 25
	us := make([]testutil.User, users)
	ids := make([][]string, users)
	for i := range us {
		us[i] = testutil.NewUser(t)
		c := testutil.NewClient(t).As(us[i])
		for range 3 {
			id := testutil.NewUUID()
			ids[i] = append(ids[i], id)
			mustSave(t, c, added(ev(id, baseTS, testutil.BucketID(1))))
		}
	}
	var bad, total atomic.Int64
	var wg sync.WaitGroup
	for i, u := range us {
		wg.Go(func() {
			for r := range rounds {
				c := testutil.NewClient(t).As(u)
				var evs []map[string]any
				for _, id := range ids[i] {
					evs = append(evs, notifyEvent(id, notifyTime{"at": inMinutes(10 + r), "device": false}))
				}
				total.Add(1)
				if status, _ := syncNotifications(c, notifyBody("", evs...)); status != 200 {
					bad.Add(1)
				}
			}
		})
	}
	wg.Wait()
	if bad.Load() != 0 {
		t.Fatalf("%d of %d syncs failed", bad.Load(), total.Load())
	}
}
