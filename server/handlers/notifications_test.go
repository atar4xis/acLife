package handlers_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/handlers"
	"acLife/internal/testutil"
)

type notifyTime = map[string]any

func notifyBody(endpoint string, events ...map[string]any) map[string]any {
	return map[string]any{"endpoint": endpoint, "events": events}
}

func notifyEvent(id string, times ...notifyTime) map[string]any {
	if times == nil {
		times = []notifyTime{}
	}
	return map[string]any{"id": id, "times": times}
}

func inMinutes(minutes int) int64 {
	return time.Now().Add(time.Duration(minutes) * time.Minute).UnixMilli()
}

func syncNotifications(c *testutil.Client, body map[string]any) (int, []string) {
	status, reply := testutil.Call[map[string][]string](c, "POST", "/calendar/notifications/sync", body)
	return status, reply.Data["retry"]
}

func scheduledCount(t *testing.T, where string, args ...any) int {
	t.Helper()

	var n int
	if err := database.DB.QueryRow("SELECT COUNT(*) FROM scheduled_notifications WHERE "+where, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func insertSubscription(t *testing.T, owner, endpoint string) int64 {
	t.Helper()

	res, err := database.DB.Exec(
		"INSERT INTO push_subscriptions (owner, endpoint, p256dh, auth) VALUES (?, ?, 'p', 'a')",
		owner, endpoint,
	)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

func TestSyncNotificationsStoresRowsAndAsksToRetryMissingEvents(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	other := testutil.NewUser(t)
	mine, theirs, unknown := testutil.NewUUID(), testutil.NewUUID(), testutil.NewUUID()
	insertEvents(t, user.UUID, mine)
	insertEvents(t, other.UUID, theirs)

	status, retry := syncNotifications(testutil.NewClient(t).As(user), notifyBody("",
		notifyEvent(mine, notifyTime{"at": inMinutes(5)}, notifyTime{"at": inMinutes(10)}),
		notifyEvent(theirs, notifyTime{"at": inMinutes(5)}),
		notifyEvent(unknown, notifyTime{"at": inMinutes(5)}),
	))
	if status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
	if len(retry) != 2 {
		t.Fatalf("retry: %v", retry)
	}
	if got := scheduledCount(t, "owner = ?", user.UUID); got != 2 {
		t.Fatalf("own rows: %d", got)
	}
	if got := scheduledCount(t, "owner = ?", other.UUID); got != 0 {
		t.Fatalf("foreign event got %d rows", got)
	}
}

func TestSyncNotificationsReplacesAndClears(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	id := testutil.NewUUID()
	insertEvents(t, user.UUID, id)
	c := testutil.NewClient(t).As(user)

	syncNotifications(c, notifyBody("", notifyEvent(id, notifyTime{"at": inMinutes(5)}, notifyTime{"at": inMinutes(6)})))
	syncNotifications(c, notifyBody("", notifyEvent(id, notifyTime{"at": inMinutes(7)})))
	if got := scheduledCount(t, "event_id = ?", id); got != 1 {
		t.Fatalf("after replace: %d", got)
	}

	syncNotifications(c, notifyBody("", notifyEvent(id)))
	if got := scheduledCount(t, "event_id = ?", id); got != 0 {
		t.Fatalf("after clear: %d", got)
	}
}

func TestSyncNotificationsScopesDeviceRowsToTheSubscription(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	id := testutil.NewUUID()
	insertEvents(t, user.UUID, id)
	first := insertSubscription(t, user.UUID, "https://push.example/first")
	second := insertSubscription(t, user.UUID, "https://push.example/second")
	c := testutil.NewClient(t).As(user)

	if _, retry := syncNotifications(c, notifyBody("https://push.example/first", notifyEvent(id, notifyTime{"at": inMinutes(5), "device": true}))); len(retry) != 0 {
		t.Fatalf("known subscription asked to retry: %v", retry)
	}
	syncNotifications(c, notifyBody("https://push.example/first", notifyEvent(id, notifyTime{"at": inMinutes(5), "device": true})))
	syncNotifications(c, notifyBody("https://push.example/second", notifyEvent(id, notifyTime{"at": inMinutes(5), "device": true}, notifyTime{"at": inMinutes(6)})))
	syncNotifications(c, notifyBody("https://push.example/second", notifyEvent(id, notifyTime{"at": inMinutes(8), "device": true})))

	if got := scheduledCount(t, "subscription_id = ?", first); got != 1 {
		t.Fatalf("first device rows: %d", got)
	}
	if got := scheduledCount(t, "subscription_id = ?", second); got != 1 {
		t.Fatalf("second device rows: %d", got)
	}
	if got := scheduledCount(t, "subscription_id IS NULL"); got != 0 {
		t.Fatalf("all-device rows: %d", got)
	}
}

func TestSyncNotificationsSkipsDeviceTimesWithoutASubscription(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	id := testutil.NewUUID()
	insertEvents(t, user.UUID, id)

	_, retry := syncNotifications(testutil.NewClient(t).As(user), notifyBody("https://push.example/gone",
		notifyEvent(id, notifyTime{"at": inMinutes(5), "device": true}, notifyTime{"at": inMinutes(7), "device": true}, notifyTime{"at": inMinutes(6)}),
	))
	if got := scheduledCount(t, "event_id = ?", id); got != 1 {
		t.Fatalf("rows: %d", got)
	}
	if len(retry) != 1 || retry[0] != id {
		t.Fatalf("retry: %v", retry)
	}
}

func TestSyncNotificationsRejectsInvalidRequests(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	id := testutil.NewUUID()
	insertEvents(t, user.UUID, id)

	tooMany := make([]notifyTime, constants.MaxNotificationTimes+1)
	for i := range tooMany {
		tooMany[i] = notifyTime{"at": inMinutes(5)}
	}

	cases := map[string]map[string]any{
		"no events":   notifyBody(""),
		"bad uuid":    notifyBody("", notifyEvent("nope", notifyTime{"at": inMinutes(5)})),
		"in the past": notifyBody("", notifyEvent(id, notifyTime{"at": inMinutes(-60 * 24)})),
		"too far":     notifyBody("", notifyEvent(id, notifyTime{"at": time.Now().Add(constants.NotificationHorizon + time.Hour).UnixMilli()})),
		"too many":    notifyBody("", notifyEvent(id, tooMany...)),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			if status, _ := syncNotifications(testutil.NewClient(t).As(user), body); status != http.StatusBadRequest {
				t.Fatalf("got %d", status)
			}
		})
	}
}

func TestSyncNotificationsCapsRowsPerUser(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	first, second := testutil.NewUUID(), testutil.NewUUID()
	insertEvents(t, user.UUID, first, second)
	c := testutil.NewClient(t).As(user)

	full := make([]notifyTime, constants.MaxNotificationTimes)
	for i := range full {
		full[i] = notifyTime{"at": inMinutes(5)}
	}
	if status, _ := syncNotifications(c, notifyBody("", notifyEvent(first, full...))); status != http.StatusOK {
		t.Fatalf("filling up: %d", status)
	}
	if status, _ := syncNotifications(c, notifyBody("", notifyEvent(second, notifyTime{"at": inMinutes(5)}))); status != http.StatusRequestEntityTooLarge {
		t.Fatalf("over the cap: %d", status)
	}
	if got := scheduledCount(t, "event_id = ?", second); got != 0 {
		t.Fatalf("rejected rows were kept: %d", got)
	}
}

func TestDeletingAnEventRemovesItsNotifications(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	id := testutil.NewUUID()
	insertEvents(t, user.UUID, id)
	syncNotifications(testutil.NewClient(t).As(user), notifyBody("", notifyEvent(id, notifyTime{"at": inMinutes(5)})))

	if _, err := database.DB.Exec("DELETE FROM calendar_events WHERE id = ?", id); err != nil {
		t.Fatal(err)
	}
	if got := scheduledCount(t, "event_id = ?", id); got != 0 {
		t.Fatalf("rows: %d", got)
	}
}

func TestSendDueNotificationsConsumesDueRowsAndDropsLateOnes(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	id := testutil.NewUUID()
	insertEvents(t, user.UUID, id)

	for _, at := range []int64{
		time.Now().Add(-time.Minute).UnixMilli(),
		time.Now().Add(-constants.NotificationGrace - time.Minute).UnixMilli(),
		inMinutes(5),
	} {
		if _, err := database.DB.Exec(
			"INSERT INTO scheduled_notifications (owner, event_id, fire_at) VALUES (?, ?, ?)",
			user.UUID, id, at,
		); err != nil {
			t.Fatal(err)
		}
	}

	handlers.SendDueNotifications(context.Background())

	if got := scheduledCount(t, "event_id = ?", id); got != 1 {
		t.Fatalf("remaining rows: %d", got)
	}
	if got := scheduledCount(t, "event_id = ? AND fire_at > ?", id, time.Now().UnixMilli()); got != 1 {
		t.Fatalf("the future row must stay: %d", got)
	}
}
