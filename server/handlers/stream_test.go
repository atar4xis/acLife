package handlers_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/handlers"
	"acLife/internal/testutil"
	"acLife/stream"
	"acLife/types"

	"mz.attahri.com/code/srp/v3"
)

func readMessage(t *testing.T, r *bufio.Reader) stream.Message {
	t.Helper()

	var name, data string
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatalf("read stream: %v", err)
		}
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "event: "):
			name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = strings.TrimPrefix(line, "data: ")
		case line == "" && name != "":
			var ev stream.Message
			if err := json.Unmarshal([]byte(data), &ev); err != nil {
				t.Fatalf("decode %q: %v", data, err)
			}
			if ev.Type != name {
				t.Fatalf("event name %q, data type %q", name, ev.Type)
			}
			return ev
		}
	}
}

func requireClosed(t *testing.T, r *bufio.Reader) {
	t.Helper()

	if _, err := r.ReadString('\n'); !errors.Is(err, io.EOF) {
		t.Fatalf("stream not closed by the server: %v", err)
	}
}

func openStream(t *testing.T, c *testutil.Client) (*bufio.Reader, stream.Message) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	resp := c.Open(ctx, "/stream")
	t.Cleanup(func() { _ = resp.Body.Close() })
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type %q", ct)
	}

	r := bufio.NewReader(resp.Body)
	hello := readMessage(t, r)
	if hello.Type != "hello" {
		t.Fatalf("first event is %q", hello.Type)
	}
	return r, hello
}

func TestStreamRequiresLogin(t *testing.T) {
	resp := testutil.NewClient(t).Open(context.Background(), "/stream")
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func TestStreamAllowsThirtyRequestsPerMinute(t *testing.T) {
	srv := testutil.NewClient(t)
	for i := range 30 {
		resp := srv.Open(context.Background(), "/stream")
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("request %d: status %d", i+1, resp.StatusCode)
		}
	}

	resp := srv.Open(context.Background(), "/stream")
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("status %d", resp.StatusCode)
	}
}

func TestStreamHelloCarriesTheCurrentSequence(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)

	_, first := openStream(t, c)
	if first.Seq != 0 {
		t.Fatalf("seq %d", first.Seq)
	}

	stream.Publish(user.UUID, stream.Sync(""))
	stream.Publish(user.UUID, stream.Sync(""))

	_, second := openStream(t, c)
	if second.Seq != 2 {
		t.Fatalf("seq %d", second.Seq)
	}
}

func TestStreamDeliversSettingsSaveToOtherDevices(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)

	mine, hello := openStream(t, c)

	status, _ := testutil.Call[any](c, "POST", "/user/settings?c=abcdef", types.SaveSettingsRequest{Data: []byte("x"), BaseVersion: 0})
	if status != http.StatusOK {
		t.Fatalf("save: %d", status)
	}

	got := readMessage(t, mine)
	if got.Type != "settings" || got.OriginClientID != "abcdef" || got.Seq != hello.Seq+1 {
		t.Fatalf("got %+v", got)
	}
}

func TestStreamDeliversOnlyToTheOwner(t *testing.T) {
	testutil.RequireDB(t)
	owner := testutil.NewUser(t)
	other := testutil.NewUser(t)

	theirs, _ := openStream(t, testutil.NewClient(t).As(other))

	stream.Publish(owner.UUID, stream.Sync("zzzzzz"))
	stream.Publish(other.UUID, stream.Settings("yyyyyy"))

	if got := readMessage(t, theirs); got.Type != "settings" {
		t.Fatalf("other user got %+v first", got)
	}
}

func TestStreamReplicatesSavedChanges(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	conn, hello := openStream(t, testutil.NewClient(t).As(user))

	a, b, gone := testutil.NewUUID(), testutil.NewUUID(), testutil.NewUUID()
	mustSave(t, c, added(ev(gone, baseTS, testutil.BucketID(1))))
	readMessage(t, conn)

	status, _ := testutil.Call[any](c, "POST", "/calendar/events/save?c=abcdef", []handlers.EventChange{
		added(ev(a, baseTS+1, testutil.BucketID(1))),
		updated(ev(b, baseTS+2, testutil.BucketID(1))),
		deleted(gone),
		updated(ev(a, baseTS+3, testutil.BucketID(1))),
	})
	if status != http.StatusOK {
		t.Fatalf("save: %d", status)
	}

	got := readMessage(t, conn)
	upserts := []stream.Change{
		{Type: "updated", ID: a, Data: ev(a, 0).Data, UpdatedAt: baseTS + 3},
		{Type: "updated", ID: b, Data: ev(b, 0).Data, UpdatedAt: baseTS + 2},
	}
	slices.SortFunc(upserts, func(x, y stream.Change) int { return strings.Compare(x.ID, y.ID) })
	want := append([]stream.Change{{Type: "deleted", ID: gone}}, upserts...)
	if got.Type != "calendar" || got.OriginClientID != "abcdef" || got.Seq != hello.Seq+2 {
		t.Fatalf("got %+v", got)
	}
	if len(got.Changes) != len(want) {
		t.Fatalf("got %+v", got.Changes)
	}
	for i := range want {
		if got.Changes[i] != want[i] {
			t.Fatalf("change %d: got %+v, want %+v", i, got.Changes[i], want[i])
		}
	}
}

func TestStreamReplicatesOnlyTheFinalStateOfEachEvent(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	conn, _ := openStream(t, c)
	bucket := testutil.BucketID(1)
	id := testutil.NewUUID()

	mustSave(t, c, added(ev(id, baseTS, bucket)), deleted(id))
	got := readMessage(t, conn)
	if len(got.Changes) != 1 || got.Changes[0] != (stream.Change{Type: "deleted", ID: id}) {
		t.Fatalf("created then deleted: got %+v", got.Changes)
	}

	mustSave(t, c, deleted(id), added(ev(id, baseTS+1, bucket)))
	got = readMessage(t, conn)
	if len(got.Changes) != 1 || got.Changes[0].Type != "added" || got.Changes[0].UpdatedAt != baseTS+1 {
		t.Fatalf("deleted then created: got %+v", got.Changes)
	}
}

func TestStreamReplicatesCalendarIDsAsSent(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	conn, _ := openStream(t, c)
	id := strings.ToUpper(testutil.NewUUID())

	mustSave(t, c, added(ev(id, baseTS, testutil.BucketID(1))))
	got := readMessage(t, conn)
	if len(got.Changes) != 1 || got.Changes[0].ID != id {
		t.Fatalf("got %+v, want id %s", got.Changes, id)
	}
}

func TestStreamReplicatesSaveWithoutValidOriginAsAnonymous(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	conn, _ := openStream(t, c)

	status, _ := testutil.Call[any](c, "POST", "/calendar/events/save?c=toolongorigin", []handlers.EventChange{
		added(ev(testutil.NewUUID(), baseTS, testutil.BucketID(1))),
	})
	if status != http.StatusOK {
		t.Fatalf("save: %d", status)
	}

	if got := readMessage(t, conn); got.OriginClientID != "" {
		t.Fatalf("origin %q", got.OriginClientID)
	}
}

func TestStreamFallsBackToSyncForLargeSaves(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	conn, _ := openStream(t, c)

	var changes []handlers.EventChange
	const dataLen = 9000
	for range constants.MaxStreamPayloadBytes/dataLen + 1 {
		e := ev(testutil.NewUUID(), baseTS, testutil.BucketID(1))
		e.Data = strings.Repeat("A", dataLen)
		changes = append(changes, added(e))
	}
	status, _ := testutil.Call[any](c, "POST", "/calendar/events/save?c=abcdef", changes)
	if status != http.StatusOK {
		t.Fatalf("save: %d", status)
	}

	got := readMessage(t, conn)
	if got.Type != "sync" || got.OriginClientID != "abcdef" || got.Changes != nil {
		t.Fatalf("got %+v", got)
	}
}

func TestStreamIgnoresRejectedSaves(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	conn, hello := openStream(t, c)

	status, _ := testutil.Call[any](c, "POST", "/calendar/events/save", []handlers.EventChange{
		added(ev("not-a-uuid", baseTS, testutil.BucketID(1))),
	})
	if status != http.StatusBadRequest {
		t.Fatalf("save: %d", status)
	}

	stream.Publish(user.UUID, stream.Sync(""))
	if got := readMessage(t, conn); got.Type != "sync" || got.Seq != hello.Seq+1 {
		t.Fatalf("got %+v", got)
	}
}

func TestStreamReleasesSlotWhenClientDisconnects(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)

	ctx, cancel := context.WithCancel(context.Background())
	resp := testutil.NewClient(t).As(user).Open(ctx, "/stream")
	cancel()
	_ = resp.Body.Close()

	deadline := time.Now().Add(2 * time.Second)
	for {
		var streams []*stream.Conn
		for range constants.MaxStreamsPerUser {
			if s, ok := stream.Subscribe(user.UUID, "probe"); ok {
				streams = append(streams, s)
			}
		}
		for _, s := range streams {
			s.Close()
		}
		if len(streams) == constants.MaxStreamsPerUser {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("slot still held after disconnect")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestStreamRequiresSubscriptionWhenEnabled(t *testing.T) {
	testutil.RequireDB(t)
	requireSubscription(t)

	t.Run("no subscription", func(t *testing.T) {
		resp := testutil.NewClient(t).As(testutil.NewUser(t)).Open(context.Background(), "/stream")
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusPaymentRequired {
			t.Fatalf("status %d", resp.StatusCode)
		}
	})

	t.Run("canceled", func(t *testing.T) {
		user := testutil.NewUser(t, testutil.Subscribed("canceled"))

		resp := testutil.NewClient(t).As(user).Open(context.Background(), "/stream")
		defer func() { _ = resp.Body.Close() }()

		if resp.StatusCode != http.StatusPaymentRequired {
			t.Fatalf("status %d", resp.StatusCode)
		}
	})

	t.Run("active", func(t *testing.T) {
		user := testutil.NewUser(t, testutil.Subscribed("active"))

		openStream(t, testutil.NewClient(t).As(user))
	})
}

func TestStreamClosesWhenSessionEnds(t *testing.T) {
	testutil.RequireDB(t)

	t.Run("logout", func(t *testing.T) {
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		conn, _ := openStream(t, c)

		if status, _ := testutil.Call[any](c, "POST", "/auth/logout", nil); status != http.StatusOK {
			t.Fatalf("logout: %d", status)
		}
		requireClosed(t, conn)
	})

	t.Run("revoked from another device", func(t *testing.T) {
		user := testutil.NewUser(t)
		srv := testutil.NewClient(t)
		current, revoked := srv.As(user), srv.As(user)
		conn, _ := openStream(t, revoked)

		var target string
		for _, s := range listSessions(t, current) {
			if !s.Current {
				target = s.ID
			}
		}
		if status, _ := testutil.Call[any](current, "DELETE", "/user/sessions/"+target, nil); status != http.StatusOK {
			t.Fatalf("revoke: %d", status)
		}
		requireClosed(t, conn)
	})

	t.Run("other sessions keep their stream", func(t *testing.T) {
		user := testutil.NewUser(t)
		srv := testutil.NewClient(t)
		loggingOut, staying := srv.As(user), srv.As(user)
		conn, _ := openStream(t, staying)

		testutil.Call[any](loggingOut, "POST", "/auth/logout", nil)

		stream.Publish(user.UUID, stream.Sync(""))
		if got := readMessage(t, conn); got.Type != "sync" {
			t.Fatalf("got %+v", got)
		}
	})

	t.Run("expiry", func(t *testing.T) {
		user := testutil.NewUser(t)
		srv := testutil.NewClient(t)
		conn, _ := openStream(t, srv.WithCookie(testutil.NewSession(t, user, time.Now().Add(2*time.Second))))

		requireClosed(t, conn)
	})
}

func TestStreamStaysOpenWithoutRequiredSubscription(t *testing.T) {
	testutil.RequireDB(t)
	t.Setenv("STRIPE_WEBHOOK_SECRET", webhookSecret)

	reportStripeStatus(t, "canceled")
	user := testutil.NewUser(t, testutil.Subscribed("active"))
	srv := testutil.NewClient(t)
	conn, _ := openStream(t, srv.As(user))

	if status := signedWebhook(t, srv, subscriptionEvent("customer.subscription.deleted", user.SubscriptionID, "canceled")); status != http.StatusOK {
		t.Fatalf("webhook: %d", status)
	}

	stream.Publish(user.UUID, stream.Sync(""))
	if got := readMessage(t, conn); got.Type != "sync" {
		t.Fatalf("got %+v", got)
	}
}

func TestStreamClosesWhenSubscriptionLapses(t *testing.T) {
	testutil.RequireDB(t)
	requireSubscription(t)
	t.Setenv("STRIPE_WEBHOOK_SECRET", webhookSecret)

	user := testutil.NewUser(t, testutil.Subscribed("active"))
	bystander := testutil.NewUser(t, testutil.Subscribed("active"))
	srv := testutil.NewClient(t)
	mine, _ := openStream(t, srv.As(user))
	theirs, _ := openStream(t, srv.As(bystander))

	reportStripeStatus(t, "active")
	if status := signedWebhook(t, srv, subscriptionEvent("customer.subscription.updated", user.SubscriptionID, "active")); status != http.StatusOK {
		t.Fatalf("webhook: %d", status)
	}
	stream.Publish(user.UUID, stream.Sync(""))
	if got := readMessage(t, mine); got.Type != "sync" {
		t.Fatalf("active update closed the stream: %+v", got)
	}

	reportStripeStatus(t, "canceled")
	if status := signedWebhook(t, srv, subscriptionEvent("customer.subscription.deleted", user.SubscriptionID, "canceled")); status != http.StatusOK {
		t.Fatalf("webhook: %d", status)
	}
	requireClosed(t, mine)

	stream.Publish(bystander.UUID, stream.Sync(""))
	if got := readMessage(t, theirs); got.Type != "sync" {
		t.Fatalf("got %+v", got)
	}
}

func tripletFor(t *testing.T, username string, salt, verifier []byte) []byte {
	t.Helper()

	triplet, err := srp.NewTriplet(username, salt, verifier)
	if err != nil {
		t.Fatal(err)
	}
	return triplet
}

func TestStreamClosesWhenCredentialsChange(t *testing.T) {
	testutil.RequireDB(t)

	t.Run("password change closes other sessions only", func(t *testing.T) {
		user := testutil.NewUser(t)
		srv := testutil.NewClient(t)
		changing, other := srv.As(user), srv.As(user)
		changingStream, _ := openStream(t, changing)
		otherStream, _ := openStream(t, other)

		body := testutil.Reauth(t, changing, user, testutil.Password)
		body["triplet"] = tripletFor(t, user.Email, bytes.Repeat([]byte{3}, 16), bytes.Repeat([]byte{4}, 32))
		body["envelopes"] = []types.KeyEnvelope{{Type: "master", Version: 1, Salt: []byte{1}, Data: []byte{1}, KDFParams: "{}"}}
		status, reply := testutil.Call[any](changing, "POST", "/user/password", body)
		if status != http.StatusOK {
			t.Fatalf("change password: %d %+v", status, reply)
		}

		requireClosed(t, otherStream)
		stream.Publish(user.UUID, stream.Sync(""))
		if got := readMessage(t, changingStream); got.Type != "sync" {
			t.Fatalf("got %+v", got)
		}
	})

	t.Run("email change that needs verification closes every session", func(t *testing.T) {
		withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = true })
		user := testutil.NewUser(t)
		srv := testutil.NewClient(t)
		c, other := srv.As(user), srv.As(user)
		conn, _ := openStream(t, c)
		otherStream, _ := openStream(t, other)

		body := testutil.Reauth(t, c, user, testutil.Password)
		body["triplet"] = tripletFor(t, "changed-"+user.Email, bytes.Repeat([]byte{3}, 16), bytes.Repeat([]byte{4}, 32))
		status, reply := testutil.Call[any](c, "POST", "/user/email", body)
		if status != http.StatusForbidden {
			t.Fatalf("change email: %d %+v", status, reply)
		}

		requireClosed(t, conn)
		requireClosed(t, otherStream)
	})

	t.Run("session predating required email verification", func(t *testing.T) {
		user := testutil.NewUser(t, testutil.Unverified())
		c := testutil.NewClient(t).As(user)
		conn, _ := openStream(t, c)

		withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = true })
		if status, _ := testutil.Call[any](c, "GET", "/user", nil); status != http.StatusForbidden {
			t.Fatalf("got %d", status)
		}

		requireClosed(t, conn)
	})
}

func TestSaveWaitsForCommitSerialization(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	conn, _ := openStream(t, c)

	unlock := stream.SerializeCommits(user.UUID)
	done := make(chan int)
	go func() {
		done <- save(c, added(ev(testutil.NewUUID(), baseTS, testutil.BucketID(1))))
	}()

	select {
	case <-done:
		t.Fatal("save committed while another save held the commit lock")
	case <-time.After(200 * time.Millisecond):
	}

	unlock()
	if status := <-done; status != http.StatusOK {
		t.Fatalf("save: %d", status)
	}
	if got := readMessage(t, conn); got.Type != "calendar" {
		t.Fatalf("got %+v", got)
	}
}

func TestStreamRevalidatesOnceRegistered(t *testing.T) {
	testutil.RequireDB(t)

	// the change happens at the moment a revoke could no longer find the stream to close
	raceWith := func(t *testing.T, change string, args ...any) {
		t.Helper()
		handlers.SetAfterSubscribe(func() {
			if _, err := database.DB.Exec(change, args...); err != nil {
				t.Error(err)
			}
		})
		t.Cleanup(func() { handlers.SetAfterSubscribe(nil) })
	}

	open := func(t *testing.T, c *testutil.Client) *http.Response {
		t.Helper()
		resp := c.Open(context.Background(), "/stream")
		t.Cleanup(func() { _ = resp.Body.Close() })
		return resp
	}

	t.Run("session revoked", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		raceWith(t, "DELETE FROM account_sessions WHERE owner = ?", user.UUID)

		if resp := open(t, c); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("status %d", resp.StatusCode)
		}
	})

	t.Run("session expired", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		raceWith(t, "UPDATE account_sessions SET expires_at = ? WHERE owner = ?", time.Now().Add(-time.Minute), user.UUID)

		if resp := open(t, c); resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("status %d", resp.StatusCode)
		}
	})

	t.Run("email verification now required", func(t *testing.T) {
		withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = true })
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		raceWith(t, "UPDATE users SET email_verified = 0 WHERE uuid = ?", user.UUID)

		if resp := open(t, c); resp.StatusCode != http.StatusForbidden {
			t.Fatalf("status %d", resp.StatusCode)
		}
	})

	t.Run("subscription lapsed", func(t *testing.T) {
		requireSubscription(t)
		user := testutil.NewUser(t, testutil.Subscribed("active"))
		c := testutil.NewClient(t).As(user)
		raceWith(t, "UPDATE users SET subscription_status = 'canceled' WHERE uuid = ?", user.UUID)

		if resp := open(t, c); resp.StatusCode != http.StatusPaymentRequired {
			t.Fatalf("status %d", resp.StatusCode)
		}
	})

	t.Run("unchanged account still connects", func(t *testing.T) {
		requireSubscription(t)
		user := testutil.NewUser(t, testutil.Subscribed("trialing"))
		handlers.SetAfterSubscribe(func() {})
		t.Cleanup(func() { handlers.SetAfterSubscribe(nil) })

		openStream(t, testutil.NewClient(t).As(user))
	})

	t.Run("a refused stream frees its slot", func(t *testing.T) {
		user := testutil.NewUser(t)
		c := testutil.NewClient(t).As(user)
		raceWith(t, "DELETE FROM account_sessions WHERE owner = ?", user.UUID)
		open(t, c)

		var streams []*stream.Conn
		for range constants.MaxStreamsPerUser {
			s, ok := stream.Subscribe(user.UUID, "probe")
			if !ok {
				t.Fatal("slot still held by the refused stream")
			}
			streams = append(streams, s)
		}
		for _, s := range streams {
			s.Close()
		}
	})
}
