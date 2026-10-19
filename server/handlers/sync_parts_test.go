package handlers_test

import (
	"acLife/constants"
	"acLife/handlers"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"acLife/internal/testutil"
	"acLife/types"
)

func syncOne[T any](c *testutil.Client, path, space string, part any) (int, types.Reply[T]) {
	body := map[string]any{}
	raw, _ := json.Marshal(part)
	_ = json.Unmarshal(raw, &body)
	if space != "" {
		body["space"] = space
	}

	var out types.Reply[T]
	status, reply := testutil.Call[types.SyncReply](c, "POST", path, map[string]any{"parts": []any{body}})
	if status != http.StatusOK || len(reply.Data.Parts) != 1 {
		out.Code = reply.Code
		return status, out
	}

	answer := reply.Data.Parts[0]
	out.Success, out.Code, out.Message = answer.Success, answer.Code, answer.Message
	if !answer.Success && answer.Code == "share_not_found" {
		return http.StatusNotFound, out
	}

	raw, _ = json.Marshal(answer.Data)
	_ = json.Unmarshal(raw, &out.Data)
	return status, out
}

func syncMany(c *testutil.Client, path string, parts ...any) (int, []types.Reply[any]) {
	status, reply := testutil.Call[types.SyncReply](c, "POST", path, map[string]any{"parts": parts})
	return status, reply.Data.Parts
}

func TestBatchedSyncAnswersEverySourceInOneRequest(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann := newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "journal", "collection", "write")
	mine, theirs := jid("ab", 1), jid("cd", 1)
	jsave(t, ann.c, jadded(jev(mine, baseTS)))
	mustSaveShared(t, owner, space, sharedAdded(journalRecord(theirs, baseTS)))

	status, parts := syncMany(ann.c, "/journal/sync",
		types.JournalSyncPart{Buckets: []string{"ab"}},
		types.JournalSyncPart{Space: space, Buckets: []string{"cd"}},
	)
	if status != http.StatusOK || len(parts) != 2 || !parts[0].Success || !parts[1].Success {
		t.Fatalf("got %d %+v", status, parts)
	}

	own, shared := decodePart[types.JournalSyncResponse](parts[0]), decodePart[types.JournalSyncResponse](parts[1])
	if len(own.Added) != 1 || own.Added[0].ID != mine || len(shared.Added) != 1 || shared.Added[0].ID != theirs {
		t.Fatalf("own %+v shared %+v", own, shared)
	}
}

func TestBatchedSyncAnswersAnInaccessibleSpaceAlone(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann, eve := newActor(t), newActor(t), newActor(t)
	journal := sharedSpace(t, owner, ann, "journal", "collection", "write")
	calendar := sharedSpace(t, owner, ann, "calendar", "collection", "write")
	mustSaveShared(t, owner, journal, sharedAdded(journalRecord(jid("ab", 1), baseTS)))

	cases := map[string]struct {
		c     *testutil.Client
		space string
	}{
		"not a member":  {eve.c, journal},
		"unknown space": {ann.c, testutil.NewUUID()},
		"not a uuid":    {ann.c, "x"},
		"other kind":    {ann.c, calendar},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			status, parts := syncMany(tc.c, "/journal/sync",
				types.JournalSyncPart{Buckets: []string{"ab"}},
				types.JournalSyncPart{Space: tc.space, Buckets: []string{"ab"}},
			)
			if status != http.StatusOK || len(parts) != 2 || !parts[0].Success {
				t.Fatalf("got %d %+v", status, parts)
			}
			if parts[1].Success || parts[1].Code != "share_not_found" || parts[1].Data != nil {
				t.Fatalf("got %+v", parts[1])
			}
		})
	}
}

func TestBatchedSyncRejectsBadShapes(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	part := types.JournalSyncPart{Buckets: []string{"ab"}}
	space := testutil.NewUUID()

	tooMany := make([]any, constants.MaxSyncParts+1)
	for i := range tooMany {
		tooMany[i] = types.JournalSyncPart{Space: testutil.NewUUID(), Buckets: []string{"ab"}}
	}

	cases := map[string][]any{
		"no parts":                       {},
		"two own parts":                  {part, part},
		"the same space twice":           {types.JournalSyncPart{Space: space, Buckets: []string{"ab"}}, types.JournalSyncPart{Space: space, Buckets: []string{"cd"}}},
		"the same space in another case": {types.JournalSyncPart{Space: space, Buckets: []string{"ab"}}, types.JournalSyncPart{Space: strings.ToUpper(space), Buckets: []string{"cd"}}},
		"too many parts":                 tooMany,
		"a bad part":                     {part, types.JournalSyncPart{}},
	}
	for name, parts := range cases {
		t.Run(name, func(t *testing.T) {
			if status, _ := syncMany(c, "/journal/sync", parts...); status != http.StatusBadRequest {
				t.Fatalf("got %d", status)
			}
		})
	}

	t.Run("the maximum number of parts is accepted", func(t *testing.T) {
		if status, _ := syncMany(c, "/journal/sync", tooMany[:constants.MaxSyncParts]...); status != http.StatusOK {
			t.Fatalf("got %d", status)
		}
	})
}

func TestBatchedSyncCapsRecordsAcrossParts(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))
	records := make([]types.CachedRecord, constants.MaxRequestRecords/2+1)
	for i := range records {
		records[i] = types.CachedRecord{ID: testutil.NewUUID(), Timestamp: 1}
	}

	for path, bucket := range map[string]string{"/journal/sync": "ab", "/calendar/events/sync": testutil.BucketID(1)} {
		status, _ := syncMany(c, path,
			map[string]any{"buckets": []string{bucket}, "records": records},
			map[string]any{"space": testutil.NewUUID(), "buckets": []string{bucket}, "records": records},
		)
		if status != http.StatusBadRequest {
			t.Fatalf("%s: got %d", path, status)
		}
	}
}

func TestBatchedSyncSharesOnePageBudgetBetweenSources(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann := newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "journal", "collection", "write")
	jsave(t, ann.c, jadded(jev(jid("ab", 1), baseTS)))
	mustSaveShared(t, owner, space, sharedAdded(journalRecord(jid("ab", 2), baseTS)))

	handlers.SetJournalSyncBytes(1)
	t.Cleanup(func() { handlers.SetJournalSyncBytes(constants.MaxJournalSyncBytes) })

	_, parts := syncMany(ann.c, "/journal/sync",
		types.JournalSyncPart{Buckets: []string{"ab"}},
		types.JournalSyncPart{Space: space, Buckets: []string{"ab"}},
	)
	own, shared := decodePart[types.JournalSyncResponse](parts[0]), decodePart[types.JournalSyncResponse](parts[1])
	if len(own.Added) != 1 || len(own.Remaining) != 0 {
		t.Fatalf("own %+v", own)
	}
	if len(shared.Added) != 0 || len(shared.Remaining) != 1 || shared.Remaining[0] != "ab" {
		t.Fatalf("shared %+v", shared)
	}
}

func TestBatchedCalendarSyncAnswersEverySource(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann := newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "calendar", "collection", "write")
	b1, b2 := testutil.BucketID(1), testutil.BucketID(2)
	mine, theirs := testutil.NewUUID(), testutil.NewUUID()
	mustSave(t, ann.c, added(ev(mine, baseTS, b1)))
	mustSaveShared(t, owner, space, sharedAdded(ev(theirs, baseTS, b2)))

	status, parts := syncMany(ann.c, "/calendar/events/sync",
		types.EventSyncPart{Buckets: []string{b1}},
		types.EventSyncPart{Space: space, Hashes: map[string]string{b2: "stale"}},
		types.EventSyncPart{Space: testutil.NewUUID(), Buckets: []string{b2}},
	)
	if status != http.StatusOK || len(parts) != 3 {
		t.Fatalf("got %d %+v", status, parts)
	}

	own, hashes := decodePart[types.EventSyncResponse](parts[0]), decodePart[types.EventHashResponse](parts[1])
	if len(own.Added) != 1 || own.Added[0].ID != mine {
		t.Fatalf("own %+v", own)
	}
	if len(hashes.Mismatched) != 1 || hashes.Mismatched[0] != b2 {
		t.Fatalf("hashes %+v", hashes)
	}
	if parts[2].Success || parts[2].Code != "share_not_found" {
		t.Fatalf("got %+v", parts[2])
	}
}

func decodePart[T any](part types.Reply[any]) T {
	var out T
	raw, _ := json.Marshal(part.Data)
	_ = json.Unmarshal(raw, &out)
	return out
}

func TestCalendarSyncReportsRecordsMissingFromSpace(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann, eve := newActor(t), newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "calendar", "collection", "write")
	kept, removed := testutil.NewUUID(), testutil.NewUUID()
	mustSaveShared(t, ann, space, sharedAdded(ev(kept, baseTS, testutil.BucketID(1))), sharedAdded(ev(removed, baseTS, testutil.BucketID(1))))
	mustSaveShared(t, ann, space, sharedDeleted(removed))

	status, reply := syncOne[types.EventMissingResponse](owner.c, "/calendar/events/sync", space, types.EventSyncPart{Exists: []string{kept, removed}})
	if status != http.StatusOK || len(reply.Data.Missing) != 1 || reply.Data.Missing[0] != removed {
		t.Fatalf("got %d %+v", status, reply)
	}

	if status, _ := syncOne[types.EventMissingResponse](eve.c, "/calendar/events/sync", space, types.EventSyncPart{Exists: []string{kept}}); status != http.StatusNotFound {
		t.Fatalf("a non-member got %d", status)
	}
}

func TestCalendarSyncKeepsRecordMovedToAnotherBucket(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann := newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "calendar", "collection", "write")
	id := testutil.NewUUID()
	mustSaveShared(t, ann, space, sharedAdded(ev(id, baseTS, testutil.BucketID(1))))
	mustSaveShared(t, ann, space, sharedUpdated(ev(id, baseTS+1, testutil.BucketID(2))))

	_, diff := syncOne[types.EventSyncResponse](owner.c, "/calendar/events/sync", space,
		types.EventSyncPart{Buckets: []string{testutil.BucketID(1)}, Records: []types.CachedRecord{{ID: id, Timestamp: baseTS}}})
	if len(diff.Data.Deleted) != 1 {
		t.Fatalf("the old bucket should report the id as gone: %+v", diff)
	}

	_, reply := syncOne[types.EventMissingResponse](owner.c, "/calendar/events/sync", space, types.EventSyncPart{Exists: []string{id}})
	if len(reply.Data.Missing) != 0 {
		t.Fatalf("a moved record is not missing: %+v", reply)
	}
}

func TestCalendarSyncRejectsBadExistsParts(t *testing.T) {
	testutil.RequireDB(t)
	owner, ann := newActor(t), newActor(t)
	space := sharedSpace(t, owner, ann, "calendar", "collection", "write")

	cases := map[string]map[string]any{
		"own data":     {"exists": []string{testutil.NewUUID()}},
		"empty":        {"space": space, "exists": []string{}},
		"not a uuid":   {"space": space, "exists": []string{"nope"}},
		"over the cap": {"space": space, "exists": make([]string, constants.MaxRequestRecords+1)},
	}
	for name, part := range cases {
		if status, _ := syncMany(owner.c, "/calendar/events/sync", part); status != http.StatusBadRequest {
			t.Fatalf("%s: got %d", name, status)
		}
	}
}
