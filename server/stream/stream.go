// Package stream fans out realtime messages to a user's open streams.
package stream

import (
	"encoding/json"
	"sync"

	"acLife/constants"
	"acLife/types"
)

type Change struct {
	Type      string `json:"type"`
	ID        string `json:"id"`
	Data      string `json:"data,omitempty"`
	UpdatedAt int64  `json:"updatedAt,omitempty"`
}

// Message is numbered per user so a client can detect a gap, sync and settings carry no data.
type Message struct {
	Type           string           `json:"type"`
	Seq            uint64           `json:"seq"`
	OriginClientID string           `json:"originClientId,omitempty"`
	Changes        []Change         `json:"changes,omitempty"`
	Push           *types.PushEvent `json:"push,omitempty"`
}

func Sync(originClientID string) Message {
	return Message{Type: "sync", OriginClientID: originClientID}
}

func Settings(originClientID string) Message {
	return Message{Type: "settings", OriginClientID: originClientID}
}

func Push(ev types.PushEvent) Message {
	return Message{Type: "push", Push: &ev}
}

// CalendarChanged replicates the changes, or falls back to a sync message when they are too large to push.
func CalendarChanged(originClientID string, changes []Change) Message {
	ev := Message{Type: "calendar", OriginClientID: originClientID, Changes: changes}
	if raw, err := json.Marshal(ev); err != nil || len(raw) > constants.MaxStreamPayloadBytes {
		return Sync(originClientID)
	}
	return ev
}

// Conn is one open connection, Messages is closed when it falls behind or the server closes it.
type Conn struct {
	Messages <-chan Message
	// Seq is the sequence of the last message published before the stream opened.
	Seq uint64

	c     chan Message
	uuid  string
	token string
}

type userStreams struct {
	seq     uint64
	streams map[*Conn]struct{}
}

var (
	mu      sync.Mutex
	users   = map[string]*userStreams{}
	byToken = map[string]map[*Conn]struct{}{}
)

func Subscribe(uuid, token string) (s *Conn, ok bool) {
	mu.Lock()
	defer mu.Unlock()

	u := users[uuid]
	if u == nil {
		u = &userStreams{streams: map[*Conn]struct{}{}}
		users[uuid] = u
	}
	if len(u.streams) >= constants.MaxStreamsPerUser {
		return nil, false
	}

	c := make(chan Message, constants.StreamBuffer)
	s = &Conn{Messages: c, Seq: u.seq, c: c, uuid: uuid, token: token}
	u.streams[s] = struct{}{}
	if byToken[token] == nil {
		byToken[token] = map[*Conn]struct{}{}
	}
	byToken[token][s] = struct{}{}

	return s, true
}

func (s *Conn) Close() {
	mu.Lock()
	defer mu.Unlock()
	remove(s)
}

// Publish numbers the message and sends it to the user's streams without blocking.
func Publish(uuid string, ev Message) {
	mu.Lock()
	defer mu.Unlock()

	u := users[uuid]
	if u == nil {
		return
	}

	u.seq++
	ev.Seq = u.seq
	for s := range u.streams {
		select {
		case s.c <- ev:
		default:
			remove(s)
		}
	}
}

func CloseSession(token string) {
	mu.Lock()
	defer mu.Unlock()

	for s := range byToken[token] {
		remove(s)
	}
}

func CloseUser(uuid, keepToken string) {
	mu.Lock()
	defer mu.Unlock()

	if u := users[uuid]; u != nil {
		for s := range u.streams {
			if s.token != keepToken {
				remove(s)
			}
		}
	}
}

func remove(s *Conn) {
	u := users[s.uuid]
	if u == nil {
		return
	}
	if _, ok := u.streams[s]; !ok {
		return
	}

	delete(u.streams, s)
	if len(u.streams) == 0 {
		delete(users, s.uuid)
	}
	delete(byToken[s.token], s)
	if len(byToken[s.token]) == 0 {
		delete(byToken, s.token)
	}
	close(s.c)
}

type commitLock struct {
	mu   sync.Mutex
	refs int
}

var (
	commitMu    sync.Mutex
	commitLocks = map[string]*commitLock{}
)

// SerializeCommits keeps event order equal to commit order, call the returned func after publishing.
func SerializeCommits(uuid string) (unlock func()) {
	commitMu.Lock()
	l := commitLocks[uuid]
	if l == nil {
		l = &commitLock{}
		commitLocks[uuid] = l
	}
	l.refs++
	commitMu.Unlock()

	l.mu.Lock()
	return func() {
		l.mu.Unlock()
		commitMu.Lock()
		l.refs--
		if l.refs == 0 {
			delete(commitLocks, uuid)
		}
		commitMu.Unlock()
	}
}
