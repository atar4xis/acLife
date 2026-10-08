package handlers_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"acLife/constants"
	"acLife/database"
	"acLife/internal/testutil"
	"acLife/push"
	"acLife/stream"
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

func pushKnown(t *testing.T, c *testutil.Client, endpoint string) bool {
	t.Helper()

	status, reply := testutil.Call[map[string]bool](c, "POST", "/user/push/check", map[string]string{"endpoint": endpoint})
	if status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
	return reply.Data["known"]
}

func TestPushCheckReportsOnlyTheCallersOwnSubscriptions(t *testing.T) {
	testutil.RequireDB(t)

	owner := testutil.NewUser(t)
	other := testutil.NewUser(t)
	insertSubscription(t, owner.UUID, "https://push.example/mine")

	if !pushKnown(t, testutil.NewClient(t).As(owner), "https://push.example/mine") {
		t.Fatal("own subscription reported as gone")
	}
	if pushKnown(t, testutil.NewClient(t).As(owner), "https://push.example/other") {
		t.Fatal("unknown endpoint reported as known")
	}
	if pushKnown(t, testutil.NewClient(t).As(other), "https://push.example/mine") {
		t.Fatal("another user's subscription reported as known")
	}
}

func TestPushCheckNoLongerKnowsAnExpiredSubscription(t *testing.T) {
	testutil.RequireDB(t)

	user := testutil.NewUser(t)
	insertSubscription(t, user.UUID, "https://push.example/mine")
	if _, err := database.DB.Exec("DELETE FROM push_subscriptions WHERE endpoint = ?", "https://push.example/mine"); err != nil {
		t.Fatal(err)
	}

	if pushKnown(t, testutil.NewClient(t).As(user), "https://push.example/mine") {
		t.Fatal("deleted subscription reported as known")
	}
}

func TestSendToUserPublishesThePushToThatUsersStreams(t *testing.T) {
	testutil.RequireDB(t)

	user := testutil.NewUser(t)
	other := testutil.NewUser(t)
	mine, _ := stream.Subscribe(user.UUID, "t1")
	t.Cleanup(mine.Close)
	theirs, _ := stream.Subscribe(other.UUID, "t2")
	t.Cleanup(theirs.Close)

	push.SendToUser(context.Background(), user.UUID, push.NotificationEvent("Title", "Body"))

	select {
	case got := <-mine.Messages:
		if got.Type != "push" || got.Push == nil || *got.Push != push.NotificationEvent("Title", "Body") {
			t.Fatalf("got %+v", got)
		}
	default:
		t.Fatal("push not published")
	}
	select {
	case got := <-theirs.Messages:
		t.Fatalf("another user received %+v", got)
	default:
	}
}

func pushKeys(fill byte) (auth, p256dh string) {
	return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{fill}, 16)), base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{fill}, 65))
}

func pushSubscribeWithKeys(c *testutil.Client, endpoint string, fill byte) (int, string) {
	auth, p256dh := pushKeys(fill)
	status, reply := testutil.Call[any](c, "POST", "/user/push/subscribe", map[string]string{"endpoint": endpoint, "auth": auth, "p256dh": p256dh})
	return status, reply.Code
}

func pushSubscribeAs(c *testutil.Client, endpoint string) (int, string) {
	return pushSubscribeWithKeys(c, endpoint, 0)
}

func pushRow(t *testing.T, endpoint string) (owner, auth, p256dh string) {
	t.Helper()

	if err := database.DB.QueryRow("SELECT owner, auth, p256dh FROM push_subscriptions WHERE endpoint = ?", endpoint).Scan(&owner, &auth, &p256dh); err != nil {
		t.Fatalf("read subscription: %v", err)
	}
	return owner, auth, p256dh
}

func pushEndpoint(n int) string {
	return fmt.Sprintf("https://fcm.googleapis.com/fcm/send/%d-%s", n, testutil.RandomHex(4))
}

func pushCount(t *testing.T, owner string) int {
	t.Helper()
	return count(t, "SELECT COUNT(*) FROM push_subscriptions WHERE owner = ?", owner)
}

func limitPushSubscriptions(t *testing.T, n int) {
	t.Helper()

	old := constants.MaxPushSubscriptions
	constants.MaxPushSubscriptions = n
	t.Cleanup(func() { constants.MaxPushSubscriptions = old })
}

func TestPushSubscriptionsAreCappedPerUser(t *testing.T) {
	testutil.RequireDB(t)
	limitPushSubscriptions(t, 3)
	user := testutil.NewUser(t)
	as := func() *testutil.Client { return testutil.NewClient(t).As(user) }
	endpoints := []string{pushEndpoint(0), pushEndpoint(1), pushEndpoint(2)}

	for _, endpoint := range endpoints {
		if status, _ := pushSubscribeAs(as(), endpoint); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
	}

	t.Run("one more is refused", func(t *testing.T) {
		status, code := pushSubscribeAs(as(), pushEndpoint(3))
		if status != http.StatusConflict || code != "push_subscription_limit_reached" {
			t.Fatalf("got %d %q", status, code)
		}
		if n := pushCount(t, user.UUID); n != 3 {
			t.Fatalf("%d subscriptions", n)
		}
	})
	t.Run("renewing one at the limit works", func(t *testing.T) {
		if status, _ := pushSubscribeAs(as(), endpoints[1]); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
		if n := pushCount(t, user.UUID); n != 3 {
			t.Fatalf("%d subscriptions", n)
		}
	})
	t.Run("renewing works when the user is already over a lowered cap", func(t *testing.T) {
		limitPushSubscriptions(t, 2)
		if status, _ := pushSubscribeAs(as(), endpoints[1]); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
		if status, _ := pushSubscribeAs(as(), pushEndpoint(6)); status != http.StatusConflict {
			t.Fatalf("new endpoint over the cap: got %d", status)
		}
	})
	t.Run("unsubscribing makes room", func(t *testing.T) {
		if status, _ := testutil.Call[any](as(), "POST", "/user/push/unsubscribe", map[string]string{"endpoint": endpoints[0]}); status != http.StatusOK {
			t.Fatalf("unsubscribe: %d", status)
		}
		if status, _ := pushSubscribeAs(as(), pushEndpoint(4)); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
	})
	t.Run("other users are unaffected", func(t *testing.T) {
		if status, _ := pushSubscribeAs(testutil.NewClient(t).As(testutil.NewUser(t)), pushEndpoint(5)); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
	})
}

func TestPushSubscribeCannotTouchAnotherUsersEndpoint(t *testing.T) {
	testutil.RequireDB(t)
	owner, intruder := testutil.NewUser(t), testutil.NewUser(t)
	endpoint := pushEndpoint(0)
	if status, _ := pushSubscribeWithKeys(testutil.NewClient(t).As(owner), endpoint, 1); status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
	wantAuth, wantKey := pushKeys(1)

	t.Run("subscribing with it is refused and changes nothing", func(t *testing.T) {
		if status, _ := pushSubscribeWithKeys(testutil.NewClient(t).As(intruder), endpoint, 2); status != http.StatusBadRequest {
			t.Fatalf("got %d", status)
		}
		holder, auth, key := pushRow(t, endpoint)
		if holder != owner.UUID || auth != wantAuth || key != wantKey {
			t.Fatalf("row changed: %s %s %s", holder, auth, key)
		}
		if n := pushCount(t, intruder.UUID); n != 0 {
			t.Fatalf("%d subscriptions", n)
		}
	})
	t.Run("the refusal holds at the cap too", func(t *testing.T) {
		limitPushSubscriptions(t, 1)
		if status, _ := pushSubscribeWithKeys(testutil.NewClient(t).As(owner), endpoint, 1); status != http.StatusOK {
			t.Fatalf("owner renewing: got %d", status)
		}
		if status, _ := pushSubscribeWithKeys(testutil.NewClient(t).As(intruder), endpoint, 2); status != http.StatusBadRequest {
			t.Fatalf("got %d", status)
		}
	})
	t.Run("unsubscribing does nothing for the intruder", func(t *testing.T) {
		c := testutil.NewClient(t).As(intruder)
		if status, _ := testutil.Call[any](c, "POST", "/user/push/unsubscribe", map[string]string{"endpoint": endpoint}); status != http.StatusOK {
			t.Fatalf("unsubscribe: %d", status)
		}
		if holder, _, _ := pushRow(t, endpoint); holder != owner.UUID {
			t.Fatal("subscription removed")
		}
	})
	t.Run("the owner can renew the keys", func(t *testing.T) {
		if status, _ := pushSubscribeWithKeys(testutil.NewClient(t).As(owner), endpoint, 3); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
		auth, key := pushKeys(3)
		if holder, gotAuth, gotKey := pushRow(t, endpoint); holder != owner.UUID || gotAuth != auth || gotKey != key {
			t.Fatal("keys not renewed")
		}
	})
}

func TestRacingSubscribesToOneEndpointKeepASingleOwner(t *testing.T) {
	testutil.RequireDB(t)

	for round := range 10 {
		users := []testutil.User{testutil.NewUser(t), testutil.NewUser(t)}
		endpoint := pushEndpoint(round)
		statuses := make([]int, 2)
		var wg sync.WaitGroup
		for i, u := range users {
			wg.Go(func() { statuses[i], _ = pushSubscribeWithKeys(testutil.NewClient(t).As(u), endpoint, byte(i+1)) })
		}
		wg.Wait()

		holder, auth, _ := pushRow(t, endpoint)
		winner := 0
		if holder == users[1].UUID {
			winner = 1
		}
		wantAuth, _ := pushKeys(byte(winner + 1))
		if statuses[winner] != http.StatusOK || statuses[1-winner] != http.StatusBadRequest || auth != wantAuth {
			t.Fatalf("round %d: statuses %v, holder %s, auth %s", round, statuses, holder, auth)
		}
	}
}

func TestConcurrentPushSubscribesCannotExceedTheCap(t *testing.T) {
	testutil.RequireDB(t)
	limitPushSubscriptions(t, 3)
	user := testutil.NewUser(t)

	const writers = 10
	var wg sync.WaitGroup
	for i := range writers {
		wg.Go(func() { pushSubscribeAs(testutil.NewClient(t).As(user), pushEndpoint(i)) })
	}
	wg.Wait()

	if n := pushCount(t, user.UUID); n != 3 {
		t.Fatalf("%d subscriptions", n)
	}
}

func TestPushSubscriptionCapComesFromTheEnvironment(t *testing.T) {
	t.Cleanup(constants.Configure)

	if constants.MaxPushSubscriptions != 50 {
		t.Fatalf("default is %d", constants.MaxPushSubscriptions)
	}
	for value, want := range map[string]int{"7": 7, "0": 50, "-3": 50, "many": 50} {
		t.Setenv("MAX_PUSH_SUBSCRIPTIONS", value)
		constants.Configure()
		if constants.MaxPushSubscriptions != want {
			t.Fatalf("MAX_PUSH_SUBSCRIPTIONS=%q gives %d, want %d", value, constants.MaxPushSubscriptions, want)
		}
	}
}
