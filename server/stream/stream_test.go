package stream_test

import (
	"strings"
	"testing"
	"time"

	"acLife/constants"
	"acLife/stream"
)

func subscribe(t *testing.T, uuid, token string) *stream.Conn {
	t.Helper()

	s, ok := stream.Subscribe(uuid, token)
	if !ok {
		t.Fatal("subscribe refused")
	}
	t.Cleanup(s.Close)
	return s
}

func isClosed(s *stream.Conn) bool {
	select {
	case _, ok := <-s.Messages:
		return !ok
	default:
		return false
	}
}

func TestPublishReachesOnlyThatUsersStreams(t *testing.T) {
	a := subscribe(t, "user-a", "t1")
	b := subscribe(t, "user-b", "t2")

	stream.Publish("user-a", stream.Sync("origin"))

	if got := <-a.Messages; got.Type != "sync" || got.OriginClientID != "origin" {
		t.Fatalf("got %+v", got)
	}
	select {
	case got := <-b.Messages:
		t.Fatalf("other user received %+v", got)
	default:
	}
}

func TestPublishNumbersMessagesPerUser(t *testing.T) {
	a := subscribe(t, "seq-a", "t1")
	b := subscribe(t, "seq-b", "t2")

	stream.Publish("seq-a", stream.Sync(""))
	stream.Publish("seq-a", stream.Settings(""))
	stream.Publish("seq-b", stream.Sync(""))

	if first, second := <-a.Messages, <-a.Messages; first.Seq != 1 || second.Seq != 2 {
		t.Fatalf("got %d, %d", first.Seq, second.Seq)
	}
	if got := <-b.Messages; got.Seq != 1 {
		t.Fatalf("other user's sequence is %d", got.Seq)
	}
}

func TestEveryStreamOfAUserSeesTheSameSequence(t *testing.T) {
	a := subscribe(t, "same", "t1")
	b := subscribe(t, "same", "t2")

	stream.Publish("same", stream.Sync(""))

	if x, y := <-a.Messages, <-b.Messages; x.Seq != y.Seq {
		t.Fatalf("got %d and %d", x.Seq, y.Seq)
	}
}

func TestNewStreamStartsAtTheCurrentSequence(t *testing.T) {
	first := subscribe(t, "late", "t1")
	stream.Publish("late", stream.Sync(""))
	stream.Publish("late", stream.Sync(""))

	late := subscribe(t, "late", "t2")
	if late.Seq != 2 {
		t.Fatalf("seq %d", late.Seq)
	}

	stream.Publish("late", stream.Sync(""))
	<-first.Messages
	<-first.Messages
	if got := <-late.Messages; got.Seq != late.Seq+1 {
		t.Fatalf("first event after hello is %d", got.Seq)
	}
}

func TestSubscribeRefusesBeyondPerUserCap(t *testing.T) {
	for range constants.MaxStreamsPerUser {
		subscribe(t, "capped", "t")
	}

	if _, ok := stream.Subscribe("capped", "t"); ok {
		t.Fatal("accepted beyond cap")
	}
}

func TestCloseFreesSlot(t *testing.T) {
	var streams []*stream.Conn
	for range constants.MaxStreamsPerUser {
		streams = append(streams, subscribe(t, "freed", "t"))
	}
	streams[0].Close()
	streams[0].Close()

	if _, ok := stream.Subscribe("freed", "t"); !ok {
		t.Fatal("slot not freed")
	}
}

func TestSlowStreamIsClosedInsteadOfBlocking(t *testing.T) {
	s := subscribe(t, "slow", "t")

	for range constants.StreamBuffer + 1 {
		stream.Publish("slow", stream.Sync(""))
	}

	for range constants.StreamBuffer {
		if _, ok := <-s.Messages; !ok {
			t.Fatal("closed before draining buffered messages")
		}
	}
	if _, ok := <-s.Messages; ok {
		t.Fatal("stream still open after overflow")
	}
}

func TestCloseSessionClosesOnlyThatSessionsStreams(t *testing.T) {
	mine1 := subscribe(t, "sess", "mine")
	mine2 := subscribe(t, "sess", "mine")
	other := subscribe(t, "sess", "other")
	stranger := subscribe(t, "sess-2", "mine-too")

	stream.CloseSession("mine")

	if !isClosed(mine1) || !isClosed(mine2) {
		t.Fatal("session streams still open")
	}
	if isClosed(other) || isClosed(stranger) {
		t.Fatal("unrelated stream closed")
	}
}

func TestCloseUserKeepsTheNamedSession(t *testing.T) {
	keep := subscribe(t, "owner", "keep")
	drop := subscribe(t, "owner", "drop")
	stranger := subscribe(t, "stranger", "drop")

	stream.CloseUser("owner", "keep")

	if !isClosed(drop) {
		t.Fatal("other session still open")
	}
	if isClosed(keep) || isClosed(stranger) {
		t.Fatal("wrong stream closed")
	}

	stream.CloseUser("owner", "")
	if !isClosed(keep) {
		t.Fatal("kept session survived closing everything")
	}
}

func TestChangedFallsBackToSyncWhenTooLarge(t *testing.T) {
	small := []stream.Change{{Type: "updated", ID: "a", Data: "x", UpdatedAt: 1}}
	if got := stream.CalendarChanged("origin", small); got.Type != "calendar" || len(got.Changes) != 1 || got.OriginClientID != "origin" {
		t.Fatalf("got %+v", got)
	}

	big := []stream.Change{{Type: "updated", ID: "a", Data: strings.Repeat("x", constants.MaxStreamPayloadBytes), UpdatedAt: 1}}
	if got := stream.CalendarChanged("origin", big); got.Type != "sync" || got.OriginClientID != "origin" || got.Changes != nil {
		t.Fatalf("got %+v", got)
	}
}

func TestSerializeCommitsExcludesTheSameUserOnly(t *testing.T) {
	unlock := stream.SerializeCommits("locked")

	entered := make(chan struct{})
	go func() {
		defer close(entered)
		stream.SerializeCommits("locked")()
	}()

	other := make(chan struct{})
	go func() {
		defer close(other)
		stream.SerializeCommits("not-locked")()
	}()

	select {
	case <-other:
	case <-time.After(time.Second):
		t.Fatal("another user was blocked")
	}

	select {
	case <-entered:
		t.Fatal("second save entered while the first was committing")
	case <-time.After(50 * time.Millisecond):
	}

	unlock()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("second save never got the lock")
	}
}
