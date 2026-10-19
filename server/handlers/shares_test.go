package handlers_test

import (
	"bufio"
	"bytes"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	"acLife/constants"
	"acLife/database"
	"acLife/handlers"
	"acLife/internal/testutil"
	"acLife/stream"
	"acLife/types"
)

type actor struct {
	testutil.User
	c *testutil.Client
}

func newActor(t *testing.T) actor {
	t.Helper()

	u := testutil.NewUser(t)
	if _, err := database.DB.Exec("INSERT INTO user_keys (owner, public_key, wrapped_private) VALUES (?, ?, ?)", u.UUID, []byte("pub-"+u.UUID), []byte("priv")); err != nil {
		t.Fatal(err)
	}
	return actor{User: u, c: testutil.NewClient(t).As(u)}
}

func (a actor) member(permission string) types.NewMember {
	return types.NewMember{User: a.UUID, Permission: permission, WrappedKey: []byte("wrapped")}
}

func createSpace(t *testing.T, owner actor, kind, scope string, members ...types.NewMember) string {
	t.Helper()

	status, reply := testutil.Call[types.SpaceCreated](owner.c, "POST", "/shares/spaces", types.CreateSpaceRequest{
		ID: testutil.NewUUID(), Kind: kind, Scope: scope, OwnerKey: []byte("owner-key"), Members: members,
	})
	if status != http.StatusOK {
		t.Fatalf("create space: got %d %s", status, reply.Code)
	}
	return reply.Data.ID
}

func accept(t *testing.T, a actor, space string) {
	t.Helper()

	if status, _ := testutil.Call[any](a.c, "POST", "/shares/members/accept", types.SpaceRequest{Space: space}); status != http.StatusOK {
		t.Fatalf("accept: got %d", status)
	}
}

func sharedSpace(t *testing.T, owner, member actor, kind, scope, permission string) string {
	t.Helper()

	space := createSpace(t, owner, kind, scope, member.member(permission))
	accept(t, member, space)
	return space
}

func sharedAdded(e types.EncryptedEvent) handlers.SharedChange {
	return handlers.SharedChange{Type: "added", Record: e}
}

func sharedUpdated(e types.EncryptedEvent) handlers.SharedChange {
	return handlers.SharedChange{Type: "updated", Record: e}
}

func sharedDeleted(id string) handlers.SharedChange {
	return handlers.SharedChange{Type: "deleted", ID: id}
}

func saveShared(a actor, space string, changes ...handlers.SharedChange) (int, string) {
	status, reply := testutil.Call[any](a.c, "POST", "/shares/save?space="+space, changes)
	return status, reply.Code
}

func mustSaveShared(t *testing.T, a actor, space string, changes ...handlers.SharedChange) {
	t.Helper()
	if status, code := saveShared(a, space, changes...); status != http.StatusOK {
		t.Fatalf("shares save: got %d %s", status, code)
	}
}

func requireSharedStatus(t *testing.T, a actor, space string, want int, changes ...handlers.SharedChange) {
	t.Helper()
	if status, code := saveShared(a, space, changes...); status != want {
		t.Fatalf("shares save: got %d %s, want %d", status, code, want)
	}
}

func journalRecord(id string, ts int64) types.EncryptedEvent {
	return types.EncryptedEvent{EncryptedRecord: jev(id, ts)}
}

func sharedBytesOf(t *testing.T, owner string) int64 {
	t.Helper()

	var used int64
	if err := database.DB.QueryRow("SELECT shared_bytes FROM user_storage WHERE owner = ?", owner).Scan(&used); err != nil {
		t.Fatal(err)
	}
	return used
}

func TestKeys(t *testing.T) {
	testutil.RequireDB(t)
	u := testutil.NewUser(t)
	other := newActor(t)
	c := testutil.NewClient(t).As(u)

	t.Run("none stored yet", func(t *testing.T) {
		status, reply := testutil.Call[*types.UserKeys](c, "GET", "/user/keys", nil)
		if status != http.StatusOK || reply.Data != nil {
			t.Fatalf("got %d %+v", status, reply.Data)
		}
	})

	curve, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	publicKey := curve.PublicKey().Bytes()

	t.Run("stores once", func(t *testing.T) {
		body := types.UserKeys{PublicKey: publicKey, WrappedPrivate: []byte("priv")}
		if status, _ := testutil.Call[any](c, "POST", "/user/keys", body); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
		if status, reply := testutil.Call[any](c, "POST", "/user/keys", body); status != http.StatusConflict || reply.Code != "keys_exist" {
			t.Fatalf("got %d %s", status, reply.Code)
		}

		_, reply := testutil.Call[*types.UserKeys](c, "GET", "/user/keys", nil)
		if reply.Data == nil || !bytes.Equal(reply.Data.PublicKey, publicKey) || string(reply.Data.WrappedPrivate) != "priv" {
			t.Fatalf("got %+v", reply.Data)
		}
	})

	t.Run("rejects empty and oversized keys", func(t *testing.T) {
		user := testutil.NewUser(t)
		for _, body := range []types.UserKeys{
			{},
			{PublicKey: publicKey},
			{PublicKey: []byte("p"), WrappedPrivate: []byte("w")},
			{PublicKey: append([]byte{0x02}, publicKey[1:]...), WrappedPrivate: []byte("w")},
			{PublicKey: append(bytes.Clone(publicKey), 0), WrappedPrivate: []byte("w")},
			{PublicKey: append([]byte{0x04}, make([]byte, 64)...), WrappedPrivate: []byte("w")},
			{PublicKey: []byte("p"), WrappedPrivate: make([]byte, constants.MaxWrappedPrivateLen+1)},
		} {
			if status, _ := testutil.Call[any](testutil.NewClient(t).As(user), "POST", "/user/keys", body); status != http.StatusBadRequest {
				t.Fatalf("got %d", status)
			}
		}
	})

	t.Run("looks up by email", func(t *testing.T) {
		status, reply := testutil.Call[types.KeyLookupResponse](c, "POST", "/user/keys/lookup", types.KeyLookupRequest{Email: other.Email})
		if status != http.StatusOK || reply.Data.UUID != other.UUID || string(reply.Data.PublicKey) != "pub-"+other.UUID {
			t.Fatalf("got %d %+v", status, reply.Data)
		}
	})

	t.Run("refuses to look up yourself", func(t *testing.T) {
		for _, email := range []string{u.Email, strings.ToUpper(u.Email)} {
			c := testutil.NewClient(t).As(u)
			if status, reply := testutil.Call[any](c, "POST", "/user/keys/lookup", types.KeyLookupRequest{Email: email}); status != http.StatusBadRequest || reply.Code != "self" {
				t.Fatalf("%s: got %d %s", email, status, reply.Code)
			}
		}
	})

	t.Run("does not find strangers or users without keys", func(t *testing.T) {
		keyless := testutil.NewUser(t)
		for _, email := range []string{"nobody@example.com", keyless.Email} {
			c := testutil.NewClient(t).As(u)
			if status, reply := testutil.Call[any](c, "POST", "/user/keys/lookup", types.KeyLookupRequest{Email: email}); status != http.StatusNotFound || reply.Code != "user_not_found" {
				t.Fatalf("%s: got %d %s", email, status, reply.Code)
			}
		}
	})

	t.Run("limits lookups per user", func(t *testing.T) {
		c := testutil.NewClient(t).As(testutil.NewUser(t))
		var last int
		for range constants.KeyLookupsPerMinute + 1 {
			last, _ = testutil.Call[any](c, "POST", "/user/keys/lookup", types.KeyLookupRequest{Email: "nobody@example.com"})
		}
		if last != http.StatusTooManyRequests {
			t.Fatalf("got %d", last)
		}
	})
}

func TestSharesRequireSubscription(t *testing.T) {
	testutil.RequireDB(t)
	requireSubscription(t)
	lapsed := testutil.NewClient(t).As(testutil.NewUser(t))

	for _, path := range []string{"/shares", "/user/keys"} {
		if status, _ := testutil.Call[any](lapsed, "GET", path, nil); status != http.StatusPaymentRequired {
			t.Fatalf("%s: got %d", path, status)
		}
	}
}

func TestCreateSpace(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann := newActor(t), newActor(t)

	t.Run("lists the space for both sides", func(t *testing.T) {
		space := createSpace(t, owner, "journal", "item", ann.member("read"))

		_, mine := testutil.Call[types.ShareList](owner.c, "GET", "/shares", nil)
		if len(mine.Data.Owned) != 1 || mine.Data.Owned[0].ID != space || len(mine.Data.Owned[0].Members) != 1 {
			t.Fatalf("owner list %+v", mine.Data)
		}
		got := mine.Data.Owned[0].Members[0]
		if got.User != ann.UUID || got.Email != ann.Email || got.Status != "pending" || got.Permission != "read" {
			t.Fatalf("member %+v", got)
		}

		_, theirs := testutil.Call[types.ShareList](ann.c, "GET", "/shares", nil)
		if len(theirs.Data.Received) != 1 {
			t.Fatalf("member list %+v", theirs.Data)
		}
		r := theirs.Data.Received[0]
		if r.ID != space || r.OwnerEmail != owner.Email || r.Status != "pending" || string(r.WrappedKey) != "wrapped" || string(r.OwnerPublicKey) != "pub-"+owner.UUID {
			t.Fatalf("received %+v", r)
		}
	})

	t.Run("rejects bad requests", func(t *testing.T) {
		keyless := testutil.NewUser(t)
		base := types.CreateSpaceRequest{ID: testutil.NewUUID(), Kind: "journal", Scope: "item", OwnerKey: []byte("k"), Members: []types.NewMember{ann.member("read")}}
		bad := []struct {
			name   string
			mutate func(r *types.CreateSpaceRequest)
			want   int
		}{
			{"id", func(r *types.CreateSpaceRequest) { r.ID = "not-a-uuid" }, http.StatusBadRequest},
			{"kind", func(r *types.CreateSpaceRequest) { r.Kind = "notes" }, http.StatusBadRequest},
			{"scope", func(r *types.CreateSpaceRequest) { r.Scope = "all" }, http.StatusBadRequest},
			{"owner key", func(r *types.CreateSpaceRequest) { r.OwnerKey = nil }, http.StatusBadRequest},
			{"no members", func(r *types.CreateSpaceRequest) { r.Members = nil }, http.StatusBadRequest},
			{"permission", func(r *types.CreateSpaceRequest) {
				r.Members = []types.NewMember{{User: ann.UUID, Permission: "admin", WrappedKey: []byte("w")}}
			}, http.StatusBadRequest},
			{"self", func(r *types.CreateSpaceRequest) { r.Members = []types.NewMember{owner.member("read")} }, http.StatusBadRequest},
			{"no key", func(r *types.CreateSpaceRequest) {
				r.Members = []types.NewMember{{User: keyless.UUID, Permission: "read", WrappedKey: []byte("w")}}
			}, http.StatusNotFound},
		}
		for _, tc := range bad {
			req := base
			tc.mutate(&req)
			if status, _ := testutil.Call[any](owner.c, "POST", "/shares/spaces", req); status != tc.want {
				t.Fatalf("%s: got %d, want %d", tc.name, status, tc.want)
			}
		}

		taken := createSpace(t, owner, "journal", "item", ann.member("read"))
		reused := base
		reused.ID = taken
		if status, _ := testutil.Call[any](owner.c, "POST", "/shares/spaces", reused); status != http.StatusBadRequest {
			t.Fatalf("reused id: got %d", status)
		}

		_, mine := testutil.Call[types.ShareList](owner.c, "GET", "/shares", nil)
		for _, s := range mine.Data.Owned {
			if len(s.Members) == 0 {
				t.Fatalf("a rejected request left space %s", s.ID)
			}
		}
	})

	t.Run("refuses the owner as a member whatever the uuid case", func(t *testing.T) {
		self := types.NewMember{User: strings.ToUpper(owner.UUID), Permission: "read", WrappedKey: []byte("w")}

		status, _ := testutil.Call[any](owner.c, "POST", "/shares/spaces", types.CreateSpaceRequest{ID: testutil.NewUUID(), Kind: "journal", Scope: "item", OwnerKey: []byte("k"), Members: []types.NewMember{self}})
		if status != http.StatusBadRequest {
			t.Fatalf("create: got %d", status)
		}

		space := createSpace(t, owner, "journal", "item", ann.member("read"))
		status, _ = testutil.Call[any](owner.c, "POST", "/shares/members/add", types.AddMemberRequest{Space: space, NewMember: self})
		if status != http.StatusBadRequest {
			t.Fatalf("add: got %d", status)
		}

		_, theirs := testutil.Call[types.ShareList](owner.c, "GET", "/shares", nil)
		if len(theirs.Data.Received) != 0 {
			t.Fatalf("owner received %+v", theirs.Data.Received)
		}
	})

	t.Run("limits spaces per owner", func(t *testing.T) {
		busy := newActor(t)
		for i := range constants.MaxSharesPerOwner {
			if _, err := database.DB.Exec("INSERT INTO share_spaces (id, owner, kind, scope, owner_key) VALUES (?, ?, 'journal', 'item', 'k')", fmt.Sprintf("%08x-0000-4000-8000-000000000000", i), busy.UUID); err != nil {
				t.Fatal(err)
			}
		}
		status, reply := testutil.Call[any](busy.c, "POST", "/shares/spaces", types.CreateSpaceRequest{ID: testutil.NewUUID(), Kind: "journal", Scope: "item", OwnerKey: []byte("k"), Members: []types.NewMember{ann.member("read")}})
		if status != http.StatusConflict || reply.Code != "share_limit_reached" {
			t.Fatalf("got %d %s", status, reply.Code)
		}
	})
}

func TestOwnerLimitsHoldUnderConcurrency(t *testing.T) {
	testutil.RequireDB(t)

	runConcurrently := func(n int, call func(i int) int) (ok int) {
		statuses := make([]int, n)
		var wg sync.WaitGroup
		start := make(chan struct{})
		for i := range n {
			wg.Go(func() {
				<-start
				statuses[i] = call(i)
			})
		}
		close(start)
		wg.Wait()
		for _, status := range statuses {
			if status == http.StatusOK {
				ok++
			}
		}
		return ok
	}

	t.Run("spaces", func(t *testing.T) {
		owner := newActor(t)
		guests := []actor{newActor(t), newActor(t), newActor(t), newActor(t)}
		for i := range constants.MaxSharesPerOwner - 1 {
			if _, err := database.DB.Exec("INSERT INTO share_spaces (id, owner, kind, scope, owner_key) VALUES (?, ?, 'journal', 'item', 'k')", fmt.Sprintf("%08x-0000-4000-8000-000000000000", i), owner.UUID); err != nil {
				t.Fatal(err)
			}
		}

		created := runConcurrently(len(guests), func(i int) int {
			status, _ := testutil.Call[any](owner.c, "POST", "/shares/spaces", types.CreateSpaceRequest{ID: testutil.NewUUID(), Kind: "journal", Scope: "item", OwnerKey: []byte("k"), Members: []types.NewMember{guests[i].member("read")}})
			return status
		})
		if created != 1 {
			t.Fatalf("%d spaces were created past the limit", created)
		}
	})

	t.Run("pending invites", func(t *testing.T) {
		owner := newActor(t)
		space := createSpace(t, owner, "journal", "collection", newActor(t).member("read"))
		for range constants.MaxPendingInvites - 2 {
			if _, err := database.DB.Exec("INSERT INTO share_members (space, user, permission, wrapped_key) VALUES (?, ?, 'read', 'w')", space, newActor(t).UUID); err != nil {
				t.Fatal(err)
			}
		}
		guests := make([]actor, 8)
		for i := range guests {
			guests[i] = newActor(t)
		}

		added := runConcurrently(len(guests), func(i int) int {
			status, _ := testutil.Call[any](owner.c, "POST", "/shares/members/add", types.AddMemberRequest{Space: space, NewMember: guests[i].member("read")})
			return status
		})
		if added != 1 {
			t.Fatalf("%d invites were added past the limit", added)
		}
	})
}

func TestMembership(t *testing.T) {
	testutil.RequireDB(t)

	t.Run("a pending member gets nothing until accepting", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := createSpace(t, owner, "journal", "collection", ann.member("write"))
		requireSharedStatus(t, ann, space, http.StatusNotFound, sharedAdded(journalRecord(testutil.NewUUID(), baseTS)))
		if status, _ := syncOne[any](ann.c, "/journal/sync", space, types.JournalSyncPart{Hash: "x"}); status != http.StatusNotFound {
			t.Fatalf("sync: got %d", status)
		}

		accept(t, ann, space)
		mustSaveShared(t, ann, space, sharedAdded(journalRecord(testutil.NewUUID(), baseTS)))
	})

	t.Run("declining removes the invite", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := createSpace(t, owner, "journal", "item", ann.member("read"))
		if status, _ := testutil.Call[any](ann.c, "POST", "/shares/members/decline", types.SpaceRequest{Space: space}); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}

		_, theirs := testutil.Call[types.ShareList](ann.c, "GET", "/shares", nil)
		if len(theirs.Data.Received) != 0 {
			t.Fatalf("got %+v", theirs.Data)
		}
		if status, _ := testutil.Call[any](ann.c, "POST", "/shares/members/accept", types.SpaceRequest{Space: space}); status != http.StatusNotFound {
			t.Fatalf("accept after decline: got %d", status)
		}
	})

	t.Run("an accepted member cannot decline", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		sharedSpace(t, owner, ann, "journal", "item", "read")
		space := firstOwnedSpace(t, owner)
		if status, _ := testutil.Call[any](ann.c, "POST", "/shares/members/decline", types.SpaceRequest{Space: space}); status != http.StatusNotFound {
			t.Fatalf("got %d", status)
		}
	})

	t.Run("only the owner manages members", func(t *testing.T) {
		owner, ann, bob := newActor(t), newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")

		for name, call := range map[string]func() int{
			"add": func() int {
				s, _ := testutil.Call[any](ann.c, "POST", "/shares/members/add", types.AddMemberRequest{Space: space, NewMember: bob.member("read")})
				return s
			},
			"permission": func() int {
				s, _ := testutil.Call[any](ann.c, "POST", "/shares/members/permission", types.PermissionRequest{Space: space, User: ann.UUID, Permission: "write"})
				return s
			},
			"remove other": func() int {
				s, _ := testutil.Call[any](bob.c, "DELETE", "/shares/members/"+space+"/"+ann.UUID, nil)
				return s
			},
			"delete space": func() int { s, _ := testutil.Call[any](ann.c, "DELETE", "/shares/spaces/"+space, nil); return s },
		} {
			if status := call(); status != http.StatusNotFound {
				t.Fatalf("%s: got %d", name, status)
			}
		}
	})

	t.Run("a member cannot remove another member", func(t *testing.T) {
		owner, ann, bob := newActor(t), newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		accept(t, bob, addWriter(t, owner, space, bob))

		if status, _ := testutil.Call[any](ann.c, "DELETE", "/shares/members/"+space+"/"+bob.UUID, nil); status != http.StatusNotFound {
			t.Fatalf("got %d", status)
		}
		mustSaveShared(t, bob, space, sharedAdded(journalRecord(jid("ab", 1), baseTS)))
	})

	t.Run("the owner removes a member at once", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		mustSaveShared(t, ann, space, sharedAdded(journalRecord(testutil.NewUUID(), baseTS)))

		if status, _ := testutil.Call[any](owner.c, "DELETE", "/shares/members/"+space+"/"+ann.UUID, nil); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
		requireSharedStatus(t, ann, space, http.StatusNotFound, sharedAdded(journalRecord(testutil.NewUUID(), baseTS+1)))
		if status, _ := testutil.Call[any](owner.c, "DELETE", "/shares/members/"+space+"/"+ann.UUID, nil); status != http.StatusNotFound {
			t.Fatalf("removing twice: got %d", status)
		}
	})

	t.Run("a member leaves", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		if status, _ := testutil.Call[any](ann.c, "DELETE", "/shares/members/"+space+"/"+ann.UUID, nil); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
		requireSharedStatus(t, ann, space, http.StatusNotFound, sharedAdded(journalRecord(testutil.NewUUID(), baseTS)))
	})

	t.Run("a pending member can leave", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := createSpace(t, owner, "journal", "item", ann.member("read"))
		if status, _ := testutil.Call[any](ann.c, "DELETE", "/shares/members/"+space+"/"+ann.UUID, nil); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}

		_, theirs := testutil.Call[types.ShareList](ann.c, "GET", "/shares", nil)
		_, mine := testutil.Call[types.ShareList](owner.c, "GET", "/shares", nil)
		if len(theirs.Data.Received) != 0 || len(mine.Data.Owned) != 0 {
			t.Fatalf("the invite or the empty space is still there: %+v %+v", theirs.Data, mine.Data)
		}
	})

	t.Run("removing someone who is not a member changes nothing", func(t *testing.T) {
		owner, ann, bob := newActor(t), newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")

		if status, _ := testutil.Call[any](owner.c, "DELETE", "/shares/members/"+space+"/"+bob.UUID, nil); status != http.StatusNotFound {
			t.Fatalf("got %d", status)
		}
		mustSaveShared(t, ann, space, sharedAdded(journalRecord(jid("ab", 1), baseTS)))
	})

	t.Run("a stranger cannot leave a space they were never invited to", func(t *testing.T) {
		owner, ann, bob := newActor(t), newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")

		status, reply := testutil.Call[any](bob.c, "DELETE", "/shares/members/"+space+"/"+bob.UUID, nil)
		if status != http.StatusNotFound || reply.Code != "share_not_found" {
			t.Fatalf("got %d %q", status, reply.Code)
		}
		mustSaveShared(t, ann, space, sharedAdded(journalRecord(jid("ab", 1), baseTS)))
	})

	t.Run("rejects ids that are not uuids", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")

		for name, path := range map[string]string{
			"space": "/shares/members/nope/" + ann.UUID,
			"user":  "/shares/members/" + space + "/nope",
		} {
			if status, _ := testutil.Call[any](owner.c, "DELETE", path, nil); status != http.StatusBadRequest {
				t.Fatalf("%s: got %d", name, status)
			}
		}
		mustSaveShared(t, ann, space, sharedAdded(journalRecord(jid("ab", 1), baseTS)))
	})

	t.Run("removing the last member deletes the space and gives its bytes back", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		mustSaveShared(t, owner, space, sharedAdded(journalRecord(jid("ab", 1), baseTS)))
		if got := sharedBytesOf(t, owner.UUID); got == 0 {
			t.Fatal("the save was not charged")
		}

		if status, _ := testutil.Call[any](owner.c, "DELETE", "/shares/members/"+space+"/"+ann.UUID, nil); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}

		_, mine := testutil.Call[types.ShareList](owner.c, "GET", "/shares", nil)
		if len(mine.Data.Owned) != 0 {
			t.Fatalf("got %+v", mine.Data.Owned)
		}
		if got := sharedBytesOf(t, owner.UUID); got != 0 {
			t.Fatalf("got %d", got)
		}
	})

	t.Run("the last member leaving or declining deletes the space", func(t *testing.T) {
		owner, ann, bob := newActor(t), newActor(t), newActor(t)
		left := sharedSpace(t, owner, ann, "journal", "collection", "write")
		declined := createSpace(t, owner, "journal", "item", bob.member("read"))

		if status, _ := testutil.Call[any](ann.c, "DELETE", "/shares/members/"+left+"/"+ann.UUID, nil); status != http.StatusOK {
			t.Fatalf("leave: got %d", status)
		}
		if status, _ := testutil.Call[any](bob.c, "POST", "/shares/members/decline", types.SpaceRequest{Space: declined}); status != http.StatusOK {
			t.Fatalf("decline: got %d", status)
		}

		_, mine := testutil.Call[types.ShareList](owner.c, "GET", "/shares", nil)
		if len(mine.Data.Owned) != 0 {
			t.Fatalf("got %+v", mine.Data.Owned)
		}
	})

	t.Run("a space with other members survives one leaving", func(t *testing.T) {
		owner, ann, bob := newActor(t), newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		add := types.AddMemberRequest{Space: space, NewMember: bob.member("read")}
		if status, _ := testutil.Call[any](owner.c, "POST", "/shares/members/add", add); status != http.StatusOK {
			t.Fatalf("add: got %d", status)
		}

		if status, _ := testutil.Call[any](ann.c, "DELETE", "/shares/members/"+space+"/"+ann.UUID, nil); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}

		_, mine := testutil.Call[types.ShareList](owner.c, "GET", "/shares", nil)
		if len(mine.Data.Owned) != 1 || len(mine.Data.Owned[0].Members) != 1 {
			t.Fatalf("got %+v", mine.Data.Owned)
		}
	})

	t.Run("adds a member later and refuses duplicates", func(t *testing.T) {
		owner, ann, bob := newActor(t), newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")

		add := types.AddMemberRequest{Space: space, NewMember: bob.member("read")}
		if status, _ := testutil.Call[any](owner.c, "POST", "/shares/members/add", add); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
		if status, reply := testutil.Call[any](owner.c, "POST", "/shares/members/add", add); status != http.StatusConflict || reply.Code != "already_member" {
			t.Fatalf("duplicate: got %d %s", status, reply.Code)
		}
	})

	t.Run("limits members and pending invites", func(t *testing.T) {
		owner := newActor(t)
		space := createSpace(t, owner, "journal", "collection", newActor(t).member("read"))
		for range constants.MaxMembersPerSpace - 1 {
			if _, err := database.DB.Exec("INSERT INTO share_members (space, user, permission, wrapped_key, status) VALUES (?, ?, 'read', 'w', 'accepted')", space, newActor(t).UUID); err != nil {
				t.Fatal(err)
			}
		}
		add := types.AddMemberRequest{Space: space, NewMember: newActor(t).member("read")}
		if status, reply := testutil.Call[any](owner.c, "POST", "/shares/members/add", add); status != http.StatusConflict || reply.Code != "share_limit_reached" {
			t.Fatalf("got %d %s", status, reply.Code)
		}
	})

	t.Run("limits the pending invites from one person to another", func(t *testing.T) {
		owner, guest := newActor(t), newActor(t)
		spaces := make([]string, constants.MaxPendingPerPair)
		for i := range spaces {
			spaces[i] = createSpace(t, owner, "journal", "item", guest.member("read"))
		}

		extra := types.CreateSpaceRequest{ID: testutil.NewUUID(), Kind: "journal", Scope: "item", OwnerKey: []byte("owner-key"), Members: []types.NewMember{guest.member("read")}}
		if status, reply := testutil.Call[any](owner.c, "POST", "/shares/spaces", extra); status != http.StatusConflict || reply.Code != "share_limit_reached" {
			t.Fatalf("got %d %s", status, reply.Code)
		}

		other := newActor(t)
		if status, _ := testutil.Call[any](other.c, "POST", "/shares/spaces", types.CreateSpaceRequest{ID: testutil.NewUUID(), Kind: "journal", Scope: "item", OwnerKey: []byte("owner-key"), Members: []types.NewMember{guest.member("read")}}); status != http.StatusOK {
			t.Fatalf("another sender: got %d", status)
		}

		accept(t, guest, spaces[0])
		if status, _ := testutil.Call[any](owner.c, "POST", "/shares/spaces", extra); status != http.StatusOK {
			t.Fatalf("after accepting: got %d", status)
		}
	})

	t.Run("a person who has too many pending invites cannot be invited", func(t *testing.T) {
		sender, target := newActor(t), newActor(t)
		for range constants.MaxPendingReceived {
			space := testutil.NewUUID()
			if _, err := database.DB.Exec("INSERT INTO share_spaces (id, owner, kind, scope, owner_key) VALUES (?, ?, 'journal', 'item', 'k')", space, newActor(t).UUID); err != nil {
				t.Fatal(err)
			}
			if _, err := database.DB.Exec("INSERT INTO share_members (space, user, permission, wrapped_key) VALUES (?, ?, 'read', 'w')", space, target.UUID); err != nil {
				t.Fatal(err)
			}
		}

		status, reply := testutil.Call[types.SpaceCreated](sender.c, "POST", "/shares/spaces", types.CreateSpaceRequest{
			ID: testutil.NewUUID(), Kind: "journal", Scope: "item", OwnerKey: []byte("owner-key"), Members: []types.NewMember{target.member("read")},
		})
		if status != http.StatusNotFound || reply.Code != "user_not_found" {
			t.Fatalf("got %d %s", status, reply.Code)
		}
	})
}

func addWriter(t *testing.T, owner actor, space string, member actor) string {
	t.Helper()

	if status, _ := testutil.Call[any](owner.c, "POST", "/shares/members/add", types.AddMemberRequest{Space: space, NewMember: member.member("write")}); status != http.StatusOK {
		t.Fatalf("add: got %d", status)
	}
	return space
}

func firstOwnedSpace(t *testing.T, owner actor) string {
	t.Helper()

	_, reply := testutil.Call[types.ShareList](owner.c, "GET", "/shares", nil)
	return reply.Data.Owned[0].ID
}

func TestSharedPermissions(t *testing.T) {
	testutil.RequireDB(t)

	t.Run("a read member can sync but not save or delete", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "read")
		id := jid("ab", 1)
		mustSaveShared(t, owner, space, sharedAdded(journalRecord(id, baseTS)))

		requireSharedStatus(t, ann, space, http.StatusForbidden, sharedUpdated(journalRecord(id, baseTS+1)))
		requireSharedStatus(t, ann, space, http.StatusForbidden, sharedDeleted(id))
		requireSharedStatus(t, ann, space, http.StatusForbidden, sharedAdded(journalRecord(jid("ab", 2), baseTS)))

		status, reply := syncOne[types.JournalSyncResponse](ann.c, "/journal/sync", space, types.JournalSyncPart{Buckets: []string{"ab"}})
		if status != http.StatusOK || len(reply.Data.Added) != 1 || reply.Data.Added[0].ID != id {
			t.Fatalf("got %d %+v", status, reply.Data)
		}
	})

	t.Run("a write member edits, creates and deletes in a collection", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		id := jid("ab", 1)
		mustSaveShared(t, owner, space, sharedAdded(journalRecord(id, baseTS)))

		mustSaveShared(t, ann, space, sharedUpdated(journalRecord(id, baseTS+1)))
		mustSaveShared(t, ann, space, sharedAdded(journalRecord(jid("ab", 2), baseTS)))
		mustSaveShared(t, ann, space, sharedDeleted(id))
	})

	t.Run("a write member only edits an item", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "item", "write")
		id := jid("ab", 1)
		mustSaveShared(t, owner, space, sharedAdded(journalRecord(id, baseTS)))

		mustSaveShared(t, ann, space, sharedUpdated(journalRecord(id, baseTS+1)))
		requireSharedStatus(t, ann, space, http.StatusForbidden, sharedDeleted(id))
		requireSharedStatus(t, ann, space, http.StatusForbidden, sharedAdded(journalRecord(jid("ab", 2), baseTS)))
		requireSharedStatus(t, ann, space, http.StatusForbidden, sharedUpdated(journalRecord(id, baseTS+2)), sharedAdded(journalRecord(jid("ab", 3), baseTS)))

		status, reply := syncOne[types.JournalSyncResponse](owner.c, "/journal/sync", space, types.JournalSyncPart{Buckets: []string{"ab"}})
		if status != http.StatusOK || len(reply.Data.Added) != 1 || reply.Data.Added[0].UpdatedAt != baseTS+1 {
			t.Fatalf("a rejected batch changed the space: %d %+v", status, reply.Data)
		}
	})

	t.Run("the owner creates and deletes in an item space", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "item", "write")
		id := jid("ab", 1)
		mustSaveShared(t, owner, space, sharedAdded(journalRecord(id, baseTS)))
		mustSaveShared(t, owner, space, sharedDeleted(id))
	})

	t.Run("changing a permission applies to the next request", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		id := jid("ab", 1)
		mustSaveShared(t, ann, space, sharedAdded(journalRecord(id, baseTS)))

		set := func(p string) {
			t.Helper()
			if status, _ := testutil.Call[any](owner.c, "POST", "/shares/members/permission", types.PermissionRequest{Space: space, User: ann.UUID, Permission: p}); status != http.StatusOK {
				t.Fatalf("permission %s: got %d", p, status)
			}
		}

		set("read")
		requireSharedStatus(t, ann, space, http.StatusForbidden, sharedUpdated(journalRecord(id, baseTS+1)))
		set("write")
		mustSaveShared(t, ann, space, sharedUpdated(journalRecord(id, baseTS+2)))
	})

	t.Run("a permission for a stranger is not found", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		if status, _ := testutil.Call[any](owner.c, "POST", "/shares/members/permission", types.PermissionRequest{Space: space, User: testutil.NewUUID(), Permission: "read"}); status != http.StatusNotFound {
			t.Fatalf("got %d", status)
		}
	})

	t.Run("outsiders and other spaces get nothing", func(t *testing.T) {
		owner, ann, eve := newActor(t), newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		other := sharedSpace(t, owner, newActor(t), "journal", "collection", "write")
		id := jid("ab", 1)
		mustSaveShared(t, owner, space, sharedAdded(journalRecord(id, baseTS)))

		requireSharedStatus(t, eve, space, http.StatusNotFound, sharedAdded(journalRecord(jid("ab", 2), baseTS)))
		requireSharedStatus(t, eve, "not-a-uuid", http.StatusNotFound, sharedAdded(journalRecord(jid("ab", 2), baseTS)))
		requireSharedStatus(t, ann, other, http.StatusNotFound, sharedDeleted(id))

		status, _ := syncOne[any](eve.c, "/journal/sync", space, types.JournalSyncPart{Buckets: []string{"ab"}})
		if status != http.StatusNotFound {
			t.Fatalf("sync: got %d", status)
		}
	})

	t.Run("an older write loses and is not published as applied", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		id := jid("ab", 1)
		newer := journalRecord(id, baseTS+10)
		mustSaveShared(t, owner, space, sharedAdded(newer))
		ownerStream, _ := openStream(t, testutil.NewClient(t).As(owner.User))
		stale := journalRecord(id, baseTS)
		stale.Data = base64.StdEncoding.EncodeToString([]byte("stale"))
		mustSaveShared(t, ann, space, sharedUpdated(stale))

		if got := readMessage(t, ownerStream); got.Type != "space-updated" || len(got.Changes) != 0 {
			t.Fatalf("the losing write was published as applied: %+v", got)
		}

		_, reply := syncOne[types.JournalSyncResponse](owner.c, "/journal/sync", space, types.JournalSyncPart{Buckets: []string{"ab"}})
		if len(reply.Data.Added) != 1 || !sameEvent(reply.Data.Added[0], newer.EncryptedRecord) {
			t.Fatalf("got %+v", reply.Data)
		}
	})

	t.Run("kinds validate their records", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		journal := sharedSpace(t, owner, ann, "journal", "collection", "write")
		calendar := sharedSpace(t, owner, ann, "calendar", "collection", "write")
		b := testutil.BucketID(1)

		requireSharedStatus(t, owner, journal, http.StatusBadRequest, sharedAdded(ev(testutil.NewUUID(), baseTS, b)))
		requireSharedStatus(t, owner, calendar, http.StatusBadRequest, sharedAdded(ev(testutil.NewUUID(), baseTS)))
		requireSharedStatus(t, owner, calendar, http.StatusBadRequest, sharedAdded(ev(testutil.NewUUID(), baseTS, "nope")))

		big := ev(testutil.NewUUID(), baseTS, b)
		big.Data = base64.StdEncoding.EncodeToString([]byte(strings.Repeat("x", constants.MaxEventLen+1)))
		requireSharedStatus(t, owner, calendar, http.StatusBadRequest, sharedAdded(big))
		requireSharedStatus(t, owner, calendar, http.StatusBadRequest, sharedAdded(ev("not-a-uuid", baseTS, b)))
		mustSaveShared(t, owner, calendar, sharedAdded(ev(testutil.NewUUID(), baseTS, b)))
	})
}

func TestSharedCalendarSync(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann := newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "calendar", "collection", "write")
	b1, b2 := testutil.BucketID(1), testutil.BucketID(2)
	id1, id2 := testutil.NewUUID(), testutil.NewUUID()
	mustSaveShared(t, owner, space, sharedAdded(ev(id1, baseTS, b1)), sharedAdded(ev(id2, baseTS, b2)))

	sync := func(req types.EventSyncPart) types.EventSyncResponse {
		t.Helper()
		status, reply := syncOne[types.EventSyncResponse](ann.c, "/calendar/events/sync", space, req)
		if status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
		return reply.Data
	}

	t.Run("returns only the requested buckets", func(t *testing.T) {
		res := sync(types.EventSyncPart{Buckets: []string{b1}})
		if len(res.Added) != 1 || res.Added[0].ID != id1 {
			t.Fatalf("got %+v", res)
		}
	})

	t.Run("diffs against the cache", func(t *testing.T) {
		res := sync(types.EventSyncPart{Buckets: []string{b1, b2}, Records: []types.CachedRecord{{ID: id1, Timestamp: baseTS - 1}, {ID: testutil.NewUUID(), Timestamp: 5}}})
		if len(res.Updated) != 1 || res.Updated[0].ID != id1 || len(res.Added) != 1 || res.Added[0].ID != id2 || len(res.Deleted) != 1 {
			t.Fatalf("got %+v", res)
		}
	})

	t.Run("matches the bucket hash vectors", func(t *testing.T) {
		good := handlers.BucketHash([]string{id1 + ":" + fmt.Sprint(baseTS)})
		_, res := syncOne[types.EventHashResponse](ann.c, "/calendar/events/sync", space, types.EventSyncPart{Hashes: map[string]string{b1: good, b2: good}})
		if len(res.Data.Mismatched) != 1 || res.Data.Mismatched[0] != b2 {
			t.Fatalf("got %+v", res.Data)
		}
	})

	t.Run("an edit moves the record to its new buckets", func(t *testing.T) {
		mustSaveShared(t, ann, space, sharedUpdated(ev(id1, baseTS+5, b2)))
		if res := sync(types.EventSyncPart{Buckets: []string{b1}}); len(res.Added) != 0 {
			t.Fatalf("still in the old bucket: %+v", res)
		}
		if res := sync(types.EventSyncPart{Buckets: []string{b2}}); len(res.Added) != 2 {
			t.Fatalf("not in the new bucket: %+v", res)
		}
	})

	t.Run("a losing write keeps the buckets", func(t *testing.T) {
		mustSaveShared(t, ann, space, sharedUpdated(ev(id1, baseTS, b1)))
		if res := sync(types.EventSyncPart{Buckets: []string{b1}}); len(res.Added) != 0 {
			t.Fatalf("got %+v", res)
		}
	})

	t.Run("rejects bad sync requests", func(t *testing.T) {
		for _, req := range []types.EventSyncPart{
			{},
			{Buckets: []string{"not base64!"}},
			{Buckets: []string{b1}, Records: []types.CachedRecord{{ID: "x", Timestamp: 1}}},
		} {
			if status, _ := syncOne[any](ann.c, "/calendar/events/sync", space, req); status != http.StatusBadRequest {
				t.Fatalf("got %d", status)
			}
		}
	})
}

func TestSharedJournalSync(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann := newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "journal", "collection", "write")
	mustSaveShared(t, owner, space, sharedAdded(journalRecord(jid("ab", 1), baseTS)), sharedAdded(journalRecord(jid("cd", 1), baseTS)))

	_, reply := syncOne[types.JournalHashResponse](ann.c, "/journal/sync", space, types.JournalSyncPart{Hash: "stale"})
	if reply.Data.Match || len(reply.Data.Table) != 256*constants.JournalHashChars {
		t.Fatalf("got %+v", reply.Data)
	}

	var lines []string
	for _, id := range []string{jid("ab", 1), jid("cd", 1)} {
		lines = append(lines, id+":"+fmt.Sprint(baseTS))
	}
	_, reply = syncOne[types.JournalHashResponse](ann.c, "/journal/sync", space, types.JournalSyncPart{Hash: handlers.BucketHash(lines)})
	if !reply.Data.Match {
		t.Fatalf("the hash of the same lines does not match: %+v", reply.Data)
	}

	t.Run("does not mix up spaces or the owner's own journal", func(t *testing.T) {
		jsave(t, owner.c, jadded(jev(jid("ef", 1), baseTS)))
		_, reply := syncOne[types.JournalSyncResponse](ann.c, "/journal/sync", space, types.JournalSyncPart{Buckets: []string{"ef"}})
		if len(reply.Data.Added) != 0 {
			t.Fatalf("got %+v", reply.Data)
		}
	})
}

func TestSharedQuota(t *testing.T) {
	testutil.RequireDB(t)

	t.Run("a member's save is charged to the owner's shared budget only", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		mustSaveShared(t, ann, space, sharedAdded(journalRecord(jid("ab", 1), baseTS)))
		want := int64(len("data-" + jid("ab", 1)))
		if got := sharedBytesOf(t, owner.UUID); got != want {
			t.Fatalf("owner shared bytes %d, want %d", got, want)
		}
		if got := getQuota(t, owner.c); got.Used != 0 {
			t.Fatalf("owner personal bytes %+v", got)
		}

		var count int
		if err := database.DB.QueryRow("SELECT COUNT(*) FROM user_storage WHERE owner = ?", ann.UUID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("the member got a counter row: %d, %v", count, err)
		}
	})

	t.Run("calendar buckets count too", func(t *testing.T) {
		owner := newActor(t)
		ann := newActor(t)
		space := sharedSpace(t, owner, ann, "calendar", "collection", "write")
		id := testutil.NewUUID()
		mustSaveShared(t, ann, space, sharedAdded(ev(id, baseTS, testutil.BucketID(1), testutil.BucketID(2))))
		want := int64(len("data-"+id) + 2*constants.BucketRowBytes)
		if got := sharedBytesOf(t, owner.UUID); got != want {
			t.Fatalf("got %d, want %d", got, want)
		}

		mustSaveShared(t, ann, space, sharedUpdated(ev(id, baseTS+1, testutil.BucketID(1))))
		if got := sharedBytesOf(t, owner.UUID); got != int64(len("data-"+id)+constants.BucketRowBytes) {
			t.Fatalf("after shrinking: %d", got)
		}
	})

	t.Run("the budgets are independent", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		setLimit(t, owner.UUID, 100)

		jsave(t, owner.c, jadded(jevSized(jid("aa", 1), baseTS, 90)))
		mustSaveShared(t, ann, space, sharedAdded(types.EncryptedEvent{EncryptedRecord: jevSized(jid("ab", 1), baseTS, 90)}))
		if status := jsaveStatus(owner.c, jadded(jevSized(jid("aa", 2), baseTS, 90))); status != http.StatusRequestEntityTooLarge {
			t.Fatalf("personal over the limit: got %d", status)
		}
		requireSharedStatus(t, ann, space, http.StatusRequestEntityTooLarge, sharedAdded(types.EncryptedEvent{EncryptedRecord: jevSized(jid("ab", 2), baseTS, 90)}))
		requireSharedStatus(t, owner, space, http.StatusRequestEntityTooLarge, sharedAdded(types.EncryptedEvent{EncryptedRecord: jevSized(jid("ab", 3), baseTS, 90)}))
	})

	t.Run("shrinking and deleting is allowed over the limit", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		id := jid("ab", 1)
		mustSaveShared(t, ann, space, sharedAdded(types.EncryptedEvent{EncryptedRecord: jevSized(id, baseTS, 90)}))
		setLimit(t, owner.UUID, 10)

		mustSaveShared(t, ann, space, sharedUpdated(types.EncryptedEvent{EncryptedRecord: jevSized(id, baseTS+1, 50)}))
		mustSaveShared(t, ann, space, sharedDeleted(id))
		if got := sharedBytesOf(t, owner.UUID); got != 0 {
			t.Fatalf("got %d", got)
		}
	})

	t.Run("deleting a space gives its bytes back", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		keep := sharedSpace(t, owner, ann, "journal", "collection", "write")
		drop := sharedSpace(t, owner, ann, "calendar", "collection", "write")
		mustSaveShared(t, owner, keep, sharedAdded(journalRecord(jid("ab", 1), baseTS)))
		mustSaveShared(t, owner, drop, sharedAdded(ev(testutil.NewUUID(), baseTS, testutil.BucketID(1))))

		if status, _ := testutil.Call[any](owner.c, "DELETE", "/shares/spaces/"+drop, nil); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
		if got := sharedBytesOf(t, owner.UUID); got != int64(len("data-"+jid("ab", 1))) {
			t.Fatalf("got %d", got)
		}

		var left int
		if err := database.DB.QueryRow("SELECT (SELECT COUNT(*) FROM share_records WHERE space = ?) + (SELECT COUNT(*) FROM share_record_buckets WHERE space = ?) + (SELECT COUNT(*) FROM share_members WHERE space = ?)", drop, drop, drop).Scan(&left); err != nil || left != 0 {
			t.Fatalf("rows left: %d, %v", left, err)
		}
		requireSharedStatus(t, ann, drop, http.StatusNotFound, sharedDeleted(testutil.NewUUID()))
	})

	t.Run("the reconcile loop corrects shared drift", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		mustSaveShared(t, ann, space, sharedAdded(journalRecord(jid("ab", 1), baseTS)))
		want := int64(len("data-" + jid("ab", 1)))

		if got := sharedBytesOf(t, owner.UUID); got != want {
			t.Fatalf("got %d, want %d", got, want)
		}

		if _, err := database.DB.Exec("UPDATE user_storage SET shared_bytes = 1 WHERE owner = ?", owner.UUID); err != nil {
			t.Fatal(err)
		}
		fixed, err := handlers.FixStorage(t.Context(), owner.UUID)
		if err != nil || !fixed {
			t.Fatalf("fixed %v, err %v", fixed, err)
		}
		if got := sharedBytesOf(t, owner.UUID); got != want {
			t.Fatalf("got %d, want %d", got, want)
		}
	})

	t.Run("an uncounted user is recounted", func(t *testing.T) {
		owner, ann := newActor(t), newActor(t)
		space := sharedSpace(t, owner, ann, "journal", "collection", "write")
		mustSaveShared(t, ann, space, sharedAdded(journalRecord(jid("ab", 1), baseTS)))
		if _, err := database.DB.Exec("UPDATE user_storage SET shared_bytes = -1 WHERE owner = ?", owner.UUID); err != nil {
			t.Fatal(err)
		}

		mustSaveShared(t, ann, space, sharedAdded(journalRecord(jid("ab", 2), baseTS)))
		if got := sharedBytesOf(t, owner.UUID); got != int64(2*len("data-"+jid("ab", 1))) {
			t.Fatalf("got %d", got)
		}
	})
}

func TestSharedStream(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann, eve := newActor(t), newActor(t), newActor(t)
	ownerStream, _ := openStream(t, testutil.NewClient(t).As(owner.User))
	annStream, _ := openStream(t, testutil.NewClient(t).As(ann.User))
	eveStream, _ := openStream(t, testutil.NewClient(t).As(eve.User))

	space := createSpace(t, owner, "journal", "collection", ann.member("write"))
	for name, r := range map[string]*bufio.Reader{"owner": ownerStream, "member": annStream} {
		if got := readMessage(t, r); got.Type != "spaces" {
			t.Fatalf("%s got %+v", name, got)
		}
	}
	accept(t, ann, space)
	readMessage(t, ownerStream)
	readMessage(t, annStream)

	id := jid("ab", 1)
	if status, _ := testutil.Call[any](ann.c, "POST", "/shares/save?space="+space+"&c=abcdef", []handlers.SharedChange{sharedAdded(journalRecord(id, baseTS))}); status != http.StatusOK {
		t.Fatalf("save: %d", status)
	}

	for name, r := range map[string]*bufio.Reader{"owner": ownerStream, "member": annStream} {
		got := readMessage(t, r)
		if got.Type != "space-updated" || got.Space != space || got.OriginClientID != "abcdef" || len(got.Changes) != 1 || got.Changes[0].ID != id {
			t.Fatalf("%s got %+v", name, got)
		}
	}

	stream.Publish(eve.UUID, stream.Sync(""))
	if got := readMessage(t, eveStream); got.Type != "sync" {
		t.Fatalf("an outsider saw %+v", got)
	}
}

func TestSharedStreamTellsARemovedMember(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann, bob := newActor(t), newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "journal", "collection", "write")
	add := types.AddMemberRequest{Space: space, NewMember: bob.member("read")}
	if status, _ := testutil.Call[any](owner.c, "POST", "/shares/members/add", add); status != http.StatusOK {
		t.Fatalf("add: got %d", status)
	}
	annStream, _ := openStream(t, testutil.NewClient(t).As(ann.User))

	if status, _ := testutil.Call[any](owner.c, "DELETE", "/shares/members/"+space+"/"+ann.UUID, nil); status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
	if got := readMessage(t, annStream); got.Type != "spaces" {
		t.Fatalf("got %+v", got)
	}

	mustSaveShared(t, owner, space, sharedAdded(journalRecord(jid("ab", 1), baseTS)))
	stream.Publish(ann.UUID, stream.Sync(""))
	if got := readMessage(t, annStream); got.Type != "sync" {
		t.Fatalf("the removed member still received %+v", got)
	}
}

func TestSharedAndPersonalSavesRunTogether(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann := newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "journal", "collection", "write")

	const rounds = 8
	var wg sync.WaitGroup
	for i := range rounds {
		wg.Go(func() {
			shared := testutil.NewClient(t).As(ann.User)
			status, _ := testutil.Call[any](shared, "POST", "/shares/save?space="+space, []handlers.SharedChange{sharedAdded(journalRecord(jid("ab", i), baseTS))})
			if status != http.StatusOK {
				t.Errorf("shared save %d: got %d", i, status)
			}
		})
		wg.Go(func() {
			personal := testutil.NewClient(t).As(owner.User)
			if status := jsaveStatus(personal, jadded(jev(jid("cd", i), baseTS))); status != http.StatusOK {
				t.Errorf("personal save %d: got %d", i, status)
			}
		})
	}
	wg.Wait()

	per := int64(len("data-" + jid("ab", 0)))
	quota := getQuota(t, owner.c)
	if shared := sharedBytesOf(t, owner.UUID); quota.Used != rounds*per || shared != rounds*per {
		t.Fatalf("got %+v and %d shared, want %d each", quota, shared, rounds*per)
	}
	if fixed, err := handlers.FixStorage(t.Context(), owner.UUID); err != nil || fixed {
		t.Fatalf("the counters drifted: fixed %v, err %v", fixed, err)
	}
}
