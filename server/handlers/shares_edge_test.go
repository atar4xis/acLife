package handlers_test

import (
	"bufio"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"acLife/constants"
	"acLife/internal/testutil"
	"acLife/stream"
	"acLife/types"
)

func TestListSharesIsEmptyNotNull(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	resp, body := c.Do("GET", "/shares", nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), `"owned":[]`) || !strings.Contains(string(body), `"received":[]`) {
		t.Fatalf("got %d %s", resp.StatusCode, body)
	}
}

func TestSharedSaveAcceptsAnySpaceIDCase(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann := newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "journal", "collection", "write")
	annStream, _ := openStream(t, testutil.NewClient(t).As(ann.User))

	mustSaveShared(t, owner, strings.ToUpper(space), sharedAdded(journalRecord(jid("ab", 1), baseTS)))

	if got := readMessage(t, annStream); got.Type != "space-updated" || got.Space != space {
		t.Fatalf("got %+v, want the lowercase space %s", got, space)
	}
}

func TestMemberRequestsAreValidated(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann, bob := newActor(t), newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "journal", "collection", "write")

	t.Run("adding a member", func(t *testing.T) {
		good := bob.member("read")
		cases := map[string]types.AddMemberRequest{
			"bad user":         {Space: space, NewMember: types.NewMember{User: "x", Permission: "read", WrappedKey: good.WrappedKey}},
			"bad permission":   {Space: space, NewMember: types.NewMember{User: bob.UUID, Permission: "admin", WrappedKey: good.WrappedKey}},
			"no wrapped key":   {Space: space, NewMember: types.NewMember{User: bob.UUID, Permission: "read"}},
			"huge wrapped key": {Space: space, NewMember: types.NewMember{User: bob.UUID, Permission: "read", WrappedKey: make([]byte, constants.MaxWrappedKeyLen+1)}},
		}
		for name, req := range cases {
			if status, _ := testutil.Call[any](owner.c, "POST", "/shares/members/add", req); status != http.StatusBadRequest {
				t.Fatalf("%s: got %d", name, status)
			}
		}
		if status, _ := testutil.Call[any](owner.c, "POST", "/shares/members/add", types.AddMemberRequest{Space: space, NewMember: types.NewMember{User: owner.UUID, Permission: "read", WrappedKey: good.WrappedKey}}); status != http.StatusBadRequest {
			t.Fatalf("adding the owner: got %d", status)
		}
	})

	t.Run("setting a permission", func(t *testing.T) {
		cases := map[string]types.PermissionRequest{
			"bad permission": {Space: space, User: ann.UUID, Permission: "admin"},
			"bad user":       {Space: space, User: "x", Permission: "read"},
		}
		for name, req := range cases {
			if status, _ := testutil.Call[any](owner.c, "POST", "/shares/members/permission", req); status != http.StatusBadRequest {
				t.Fatalf("%s: got %d", name, status)
			}
		}
	})

	t.Run("answering an invitation", func(t *testing.T) {
		for _, path := range []string{"accept", "decline"} {
			if status, _ := testutil.Call[any](ann.c, "POST", "/shares/members/"+path, types.SpaceRequest{Space: "x"}); status != http.StatusBadRequest {
				t.Fatalf("%s a bad id: got %d", path, status)
			}
		}
	})

	t.Run("accepting twice or without an invitation", func(t *testing.T) {
		if status, _ := testutil.Call[any](ann.c, "POST", "/shares/members/accept", types.SpaceRequest{Space: space}); status != http.StatusNotFound {
			t.Fatalf("second accept: got %d", status)
		}
		if status, _ := testutil.Call[any](bob.c, "POST", "/shares/members/accept", types.SpaceRequest{Space: space}); status != http.StatusNotFound {
			t.Fatalf("accept without an invitation: got %d", status)
		}
	})

	t.Run("a long email is not looked up", func(t *testing.T) {
		long := strings.Repeat("a", constants.MaxEmailLen) + "@example.com"
		if status, _ := testutil.Call[any](owner.c, "POST", "/user/keys/lookup", types.KeyLookupRequest{Email: long}); status != http.StatusBadRequest {
			t.Fatalf("got %d", status)
		}
	})
}

func TestItemSpaceOfACalendarOnlyLetsAWriterEdit(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann := newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "calendar", "item", "write")
	id, b1, b2 := testutil.NewUUID(), testutil.BucketID(1), testutil.BucketID(2)
	mustSaveShared(t, owner, space, sharedAdded(ev(id, baseTS, b1)))

	mustSaveShared(t, ann, space, sharedUpdated(ev(id, baseTS+1, b2)))
	requireSharedStatus(t, ann, space, http.StatusForbidden, sharedDeleted(id))
	requireSharedStatus(t, ann, space, http.StatusForbidden, sharedAdded(ev(testutil.NewUUID(), baseTS, b1)))

	status, reply := syncOne[types.EventSyncResponse](owner.c, "/calendar/events/sync", space, types.EventSyncPart{Buckets: []string{b2}})
	if status != http.StatusOK || len(reply.Data.Added) != 1 || reply.Data.Added[0].UpdatedAt != baseTS+1 {
		t.Fatalf("got %d %+v", status, reply.Data)
	}
}

func TestSharesStreamTellsEveryoneInvolved(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann, pending := newActor(t), newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "journal", "collection", "write")
	if status, _ := testutil.Call[any](owner.c, "POST", "/shares/members/add", types.AddMemberRequest{Space: space, NewMember: pending.member("read")}); status != http.StatusOK {
		t.Fatalf("add: got %d", status)
	}

	ownerStream, _ := openStream(t, testutil.NewClient(t).As(owner.User))
	annStream, _ := openStream(t, testutil.NewClient(t).As(ann.User))
	pendingStream, _ := openStream(t, testutil.NewClient(t).As(pending.User))

	t.Run("a permission change reaches the owner and the members", func(t *testing.T) {
		if status, _ := testutil.Call[any](owner.c, "POST", "/shares/members/permission", types.PermissionRequest{Space: space, User: ann.UUID, Permission: "read"}); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
		for name, r := range map[string]*bufio.Reader{"owner": ownerStream, "member": annStream, "invited": pendingStream} {
			if got := readMessage(t, r); got.Type != "spaces" {
				t.Fatalf("%s got %+v", name, got)
			}
		}
	})

	t.Run("a pending member does not see the content", func(t *testing.T) {
		mustSaveShared(t, owner, space, sharedAdded(journalRecord(jid("ab", 1), baseTS)))
		if got := readMessage(t, ownerStream); got.Type != "space-updated" {
			t.Fatalf("owner got %+v", got)
		}
		if got := readMessage(t, annStream); got.Type != "space-updated" {
			t.Fatalf("member got %+v", got)
		}

		stream.Publish(pending.UUID, stream.Sync(""))
		if got := readMessage(t, pendingStream); got.Type != "sync" {
			t.Fatalf("a pending member received %+v", got)
		}
	})

	t.Run("deleting the space reaches everyone", func(t *testing.T) {
		if status, _ := testutil.Call[any](owner.c, "DELETE", "/shares/spaces/"+space, nil); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
		for name, r := range map[string]*bufio.Reader{"owner": ownerStream, "member": annStream, "invited": pendingStream} {
			if got := readMessage(t, r); got.Type != "spaces" {
				t.Fatalf("%s got %+v", name, got)
			}
		}
	})
}

func TestShareBodyLimitsDifferPerRoute(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann, bob := newActor(t), newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "journal", "collection", "write")

	t.Run("membership requests stay small", func(t *testing.T) {
		raw, err := json.Marshal(types.AddMemberRequest{Space: space, NewMember: bob.member("read")})
		if err != nil {
			t.Fatal(err)
		}

		padded := append([]byte(strings.Repeat(" ", 9<<10)), raw...)
		if resp, _ := owner.c.Do("POST", "/shares/members/add", padded); resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("padded: got %d", resp.StatusCode)
		}
		if resp, _ := owner.c.Do("POST", "/shares/members/add", raw); resp.StatusCode != http.StatusOK {
			t.Fatalf("plain: got %d", resp.StatusCode)
		}
	})

	t.Run("saves may be large", func(t *testing.T) {
		record := journalRecord(jid("ab", 1), baseTS)
		record.Data = strings.Repeat("A", 12<<10)

		mustSaveShared(t, owner, space, sharedAdded(record))
	})
}
