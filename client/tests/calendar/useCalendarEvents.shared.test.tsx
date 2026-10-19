import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { t } from "../../src/i18n";
import { emitStream } from "../../src/lib/stream.ts";
import { act, renderHook } from "@testing-library/react";
import { DateTime } from "luxon";
import type { User } from "../../src/types/User.ts";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
import type { JoinedSpace, OwnedSpace } from "../../src/types/Share.ts";
import { BACKFILL_SAVE_CHUNK } from "../../src/lib/calendar/sources.ts";

const session = vi.hoisted(() => ({
  post: undefined as unknown as (endpoint: string, body: never) => unknown,
  shares: {
    joined: [] as unknown[],
    owned: [] as unknown[],
    deleteSpace: undefined as unknown as (id: string) => Promise<boolean>,
  },
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({
    post: (endpoint: string, body: unknown) =>
      session.post(endpoint, body as never),
  }),
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ ready: true, get: vi.fn(), set: vi.fn() }),
}));

vi.mock("../../src/context/ShareContext.tsx", () => ({
  useShares: () => session.shares,
}));

const { useCalendarEvents } =
  await import("../../src/hooks/calendar/useCalendarEvents.ts");
const { decryptEvents, encryptEvents } =
  await import("../../src/lib/calendar/crypt.ts");
const { computeBucketHash } = await import("../../src/lib/bucketHash.ts");
const { deriveSpaceKeys, generateSpaceKey } =
  await import("../../src/lib/shareCrypto.ts");
const { computeSyncRangeBuckets } =
  await import("../../src/lib/calendar/buckets.ts");

type Stored = {
  id: string;
  data: string;
  updatedAt: number;
  buckets: string[];
};
type SyncPart = {
  space?: string;
  hashes?: Record<string, string>;
  buckets?: string[];
  records?: { id: string; ts: number }[];
  exists?: string[];
};
type Change =
  | { type: "added" | "updated"; record: Stored }
  | { type: "deleted"; id: string };

class Store {
  rows = new Map<string, Stored>();
}

class FakeServer {
  stores = new Map<string, Store>();
  requests: { endpoint: string; body: unknown }[] = [];
  existsFails = false;

  store(name: string) {
    let store = this.stores.get(name);
    if (!store) this.stores.set(name, (store = new Store()));
    return store;
  }

  saves = (name?: string) =>
    this.requests.filter(
      (r) =>
        r.endpoint.includes("/save") &&
        (name === undefined || this.nameOf(r.endpoint) === name),
    );

  nameOf(endpoint: string) {
    const space = /space=([^&]+)/.exec(endpoint)?.[1];
    return space ?? "own";
  }

  post = async (endpoint: string, body: unknown) => {
    this.requests.push({ endpoint, body });
    if (endpoint.includes("/save")) {
      const store = this.store(this.nameOf(endpoint));
      for (const change of body as Change[]) {
        if (change.type === "deleted") store.rows.delete(change.id);
        else if (
          (store.rows.get(change.record.id)?.updatedAt ?? -1) <=
          change.record.updatedAt
        )
          store.rows.set(change.record.id, change.record);
      }
      return { success: true };
    }

    const { parts } = body as { parts: SyncPart[] };
    return {
      success: true,
      data: {
        parts: await Promise.all(parts.map((part) => this.syncPart(part))),
      },
    };
  };

  private async syncPart(req: SyncPart) {
    const store = this.store(req.space ?? "own");
    if (req.exists) {
      if (this.existsFails) return { success: false };

      return {
        success: true,
        data: { missing: req.exists.filter((id) => !store.rows.has(id)) },
      };
    }

    if (req.hashes) {
      const mismatched: string[] = [];
      for (const [bucket, hash] of Object.entries(req.hashes)) {
        const lines = Array.from(store.rows.values())
          .filter((r) => r.buckets.includes(bucket))
          .map((r) => ({ id: r.id, ts: r.updatedAt }));
        if ((await computeBucketHash(lines)) !== hash) mismatched.push(bucket);
      }
      return { success: true, data: { mismatched } };
    }

    const cached = new Map(req.records!.map((r) => [r.id, r.ts]));
    const inRange = Array.from(store.rows.values()).filter((r) =>
      r.buckets.some((b) => req.buckets!.includes(b)),
    );
    const seen = new Set(inRange.map((r) => r.id));
    return {
      success: true,
      data: {
        added: inRange.filter((r) => !cached.has(r.id)),
        updated: inRange.filter(
          (r) => cached.has(r.id) && r.updatedAt > cached.get(r.id)!,
        ),
        deleted: Array.from(cached.keys()).filter((id) => !seen.has(id)),
      },
    };
  }
}

let server: FakeServer;
let masterKey: CryptoKey;
let bucketKey: CryptoKey;
let spaceKeys: Awaited<ReturnType<typeof deriveSpaceKeys>>;

const NOW = DateTime.fromISO("2026-03-10T10:00:00Z", { zone: "utc" });
let counter = 0;
const makeEvent = (extra: Partial<CalendarEvent> = {}): CalendarEvent => {
  counter++;
  return {
    id: `00000000-0000-4000-8000-${counter.toString().padStart(12, "0")}`,
    start: NOW,
    end: NOW.plus({ hours: 1 }),
    title: `event ${counter}`,
    timestamp: 1790000000000 + counter,
    ...extra,
  } as CalendarEvent;
};

const putOwn = async (...events: CalendarEvent[]) => {
  for (const record of await encryptEvents(events, masterKey, bucketKey))
    server.store("own").rows.set(record.id, record as Stored);
};

const putSpace = async (...events: CalendarEvent[]) => {
  for (const record of await encryptEvents(
    events,
    spaceKeys.key,
    spaceKeys.bucketKey,
  ))
    server.store("space-1").rows.set(record.id, record as Stored);
};

const joined = (
  permission: "read" | "write" = "write",
  scope: "item" | "collection" = "collection",
): JoinedSpace => ({
  id: "space-1",
  owner: "owner-1",
  ownerEmail: "owner@example.com",
  ownerPublicKey: "",
  kind: "calendar",
  scope,
  permission,
  keys: spaceKeys,
});

const owned = (
  target: string | null,
  scope: "item" | "collection" = "collection",
  id = "space-1",
): OwnedSpace => ({
  id,
  kind: "calendar",
  scope,
  target,
  members: [],
  raw: new Uint8Array(32),
  keys: spaceKeys,
});

const mount = () =>
  renderHook(() =>
    useCalendarEvents({ type: "online" } as User, masterKey, bucketKey),
  );

const sync = async (hook: ReturnType<typeof mount>) => {
  let events: CalendarEvent[] = [];
  await act(async () => {
    events = await hook.result.current.syncEvents(
      { type: "online" } as User,
      masterKey,
      bucketKey,
      NOW,
    );
  });
  return events;
};

const decryptSaved = async (name: string, key: CryptoKey) => {
  const rows = Array.from(server.store(name).rows.values());
  return (await decryptEvents(rows, key)).map((d) => d.data);
};

beforeEach(async () => {
  server = new FakeServer();
  session.post = server.post;
  session.shares = {
    joined: [],
    owned: [],
    deleteSpace: vi.fn(async () => true),
  };
  masterKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  bucketKey = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  spaceKeys = await deriveSpaceKeys(generateSpaceKey());
});

afterEach(() => vi.clearAllMocks());

describe("calendars shared with me", () => {
  it("returns my events and the shared ones, marked with their space", async () => {
    const mine = makeEvent({ title: "mine" });
    const theirs = makeEvent({ title: "theirs" });
    await putOwn(mine);
    await putSpace(theirs);
    session.shares.joined = [joined("read")];

    const events = await sync(mount());

    expect(events.map((e) => e.title).toSorted()).toEqual(["mine", "theirs"]);
    expect(events.find((e) => e.title === "mine")?._shared).toBeUndefined();
    expect(events.find((e) => e.title === "theirs")?._shared).toEqual({
      space: "space-1",
      owner: "owner-1",
      scope: "collection",
      permission: "read",
    });
  });

  it("prefers my own copy when the same event is in both", async () => {
    const event = makeEvent({ title: "same" });
    await putOwn(event);
    await putSpace({ ...event, title: "shared copy" });
    session.shares.joined = [joined()];

    const events = await sync(mount());
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("same");
  });

  it("keeps working when the shared calendar cannot be reached", async () => {
    await putOwn(makeEvent({ title: "mine" }));
    session.shares.joined = [joined()];
    const post = server.post;
    session.post = async (endpoint: string, body: unknown) =>
      endpoint.startsWith("shares/")
        ? { success: false, message: "down" }
        : post(endpoint, body);

    const events = await sync(mount());
    expect(events.map((e) => e.title)).toEqual(["mine"]);
  });

  it("falls back to the cached window of a shared calendar that cannot be reached", async () => {
    const later = NOW.plus({ years: 2 });
    const nearby = makeEvent({ title: "nearby" });
    const distant = makeEvent({
      title: "distant",
      start: later,
      end: later.plus({ hours: 1 }),
    });
    await putSpace(nearby, distant);
    session.shares.joined = [joined()];
    const hook = mount();

    const syncAt = async (date: DateTime) => {
      let events: CalendarEvent[] = [];
      await act(async () => {
        events = await hook.result.current.syncEvents(
          { type: "online" } as User,
          masterKey,
          bucketKey,
          date,
        );
      });
      return events;
    };
    await syncAt(NOW);
    await syncAt(later);

    const post = server.post;
    session.post = async (endpoint: string, body: unknown) => {
      const res = (await post(endpoint, body)) as {
        data: { parts: { success: boolean }[] };
      };
      const { parts } = body as { parts: { space?: string }[] };
      res.data.parts = res.data.parts.map((part, i) =>
        parts[i].space ? { success: false } : part,
      );
      return res;
    };

    const events = await syncAt(NOW);
    expect(events.map((e) => e.title)).toEqual(["nearby"]);
    expect(events[0]._shared?.space).toBe("space-1");
  });

  it("loads the cached shared events along with mine while offline", async () => {
    await putOwn(makeEvent({ title: "mine" }));
    await putSpace(makeEvent({ title: "theirs" }));
    session.shares.joined = [joined("read")];
    const hook = mount();
    await sync(hook);

    session.post = async () => ({ success: false, message: "offline" });
    let events: CalendarEvent[] = [];
    await act(async () => {
      events = await hook.result.current.loadEvents(
        { type: "online" } as User,
        masterKey,
        bucketKey,
        NOW,
      );
    });

    expect(events.map((e) => e.title).toSorted()).toEqual(["mine", "theirs"]);
    expect(events.find((e) => e.title === "theirs")?._shared?.space).toBe(
      "space-1",
    );
  });

  it("never re-saves a calendar I may only read", async () => {
    const theirs = makeEvent({ title: "theirs", timestamp: 5000 });
    await putSpace(theirs);
    session.shares.joined = [joined("read")];
    const hook = mount();
    await sync(hook);

    server.store("space-1").rows.get(theirs.id)!.updatedAt = 4000;
    await sync(hook);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(server.saves("space-1")).toHaveLength(0);
  });

  it("re-saves a calendar I may write when the server copy is stale", async () => {
    const theirs = makeEvent({ title: "theirs", timestamp: 5000 });
    await putSpace(theirs);
    session.shares.joined = [joined("write")];
    const hook = mount();
    await sync(hook);

    server.store("space-1").rows.get(theirs.id)!.updatedAt = 4000;
    await sync(hook);

    await vi.waitFor(() =>
      expect(server.saves("space-1").length).toBeGreaterThan(0),
    );
  });

  it("saves changes of a shared event to its space, encrypted with the space key", async () => {
    const theirs = makeEvent({ title: "theirs" });
    await putSpace(theirs);
    session.shares.joined = [joined()];
    const hook = mount();
    const [shared] = (await sync(hook)).filter((e) => e._shared);

    const cb = vi.fn();
    await act(async () => {
      await hook.result.current.saveEvents(
        [{ type: "updated", event: { ...shared, title: "edited" } }],
        cb,
      );
    });

    expect(cb).toHaveBeenCalled();
    expect(server.saves("own")).toHaveLength(0);
    const [saved] = await decryptSaved("space-1", spaceKeys.key);
    expect(saved.title).toBe("edited");
    expect(saved).not.toHaveProperty("_shared");
  });

  it("sends a deleted event to the space it belonged to", async () => {
    const theirs = makeEvent();
    await putSpace(theirs);
    session.shares.joined = [joined()];
    const hook = mount();
    await sync(hook);

    await act(async () => {
      await hook.result.current.saveEvents(
        [{ type: "deleted", id: theirs.id, space: "space-1" }],
        vi.fn(),
      );
    });

    expect(server.store("space-1").rows.size).toBe(0);
    expect(server.saves("own")).toHaveLength(0);
  });

  it("does not send anything for a space I may only read", async () => {
    const theirs = makeEvent();
    await putSpace(theirs);
    session.shares.joined = [joined("read")];
    const hook = mount();
    const [shared] = (await sync(hook)).filter((e) => e._shared);

    await act(async () => {
      await hook.result.current.saveEvents(
        [{ type: "updated", event: { ...shared, title: "x" } }],
        vi.fn(),
      );
    });
    expect(server.saves("space-1")).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledWith(t("events.saveFailed"));
  });

  it("splits one batch between my calendar and the shared one", async () => {
    await putSpace(makeEvent());
    session.shares.joined = [joined()];
    const hook = mount();
    const [shared] = (await sync(hook)).filter((e) => e._shared);
    const mine = makeEvent({ title: "new mine" });

    await act(async () => {
      await hook.result.current.saveEvents(
        [
          { type: "added", event: mine },
          { type: "updated", event: { ...shared, title: "edited" } },
        ],
        vi.fn(),
      );
    });

    expect(server.store("own").rows.has(mine.id)).toBe(true);
    expect(server.store("space-1").rows.has(shared.id)).toBe(true);
    expect(server.store("space-1").rows.has(mine.id)).toBe(false);
  });
});

describe("moving an event to another calendar", () => {
  const moveToOwn = async (hook: ReturnType<typeof mount>) => {
    const [shared] = (await sync(hook)).filter((e) => e._shared);
    const { _shared, ...own } = shared;
    void _shared;
    await act(async () => {
      await hook.result.current.saveEvents(
        [
          { type: "deleted", id: shared.id, space: "space-1" },
          { type: "added", event: own },
        ],
        vi.fn(),
      );
    });
    return shared;
  };

  it("adds it to the new calendar and then deletes the original", async () => {
    await putSpace(makeEvent());
    session.shares.joined = [joined()];
    const hook = mount();

    const moved = await moveToOwn(hook);

    expect(server.store("own").rows.has(moved.id)).toBe(true);
    expect(server.store("space-1").rows.has(moved.id)).toBe(false);
  });

  it("keeps the original when the new calendar refuses it", async () => {
    await putSpace(makeEvent());
    session.shares.joined = [joined()];
    const hook = mount();
    const post = server.post;
    session.post = async (endpoint: string, body: unknown) =>
      endpoint.startsWith("calendar/events/save")
        ? { success: false, code: "storage_limit_reached" }
        : post(endpoint, body);

    const moved = await moveToOwn(hook);

    expect(server.store("space-1").rows.has(moved.id)).toBe(true);
  });
});

describe("moving an event out of my calendar together with another edit", () => {
  it("keeps the original when the shared calendar refuses it", async () => {
    const moved = makeEvent();
    const other = makeEvent();
    await putOwn(moved, other);
    session.shares.joined = [joined()];
    const hook = mount();
    await sync(hook);
    const post = server.post;
    session.post = async (endpoint: string, body: unknown) =>
      endpoint.startsWith("shares/save")
        ? { success: false, code: "internal_error" }
        : post(endpoint, body);

    await act(async () => {
      await hook.result.current.saveEvents(
        [
          { type: "updated", event: { ...other, title: "edited" } },
          { type: "deleted", id: moved.id },
          {
            type: "added",
            event: {
              ...moved,
              _shared: {
                space: "space-1",
                owner: "owner-1",
                scope: "collection",
                permission: "write",
              },
            },
          },
        ],
        vi.fn(),
      );
    });

    expect(server.store("own").rows.has(moved.id)).toBe(true);
  });

  it("keeps the original when the shared calendar is no longer joined", async () => {
    const moved = makeEvent();
    const other = makeEvent();
    await putOwn(moved, other);
    const hook = mount();
    await sync(hook);

    await act(async () => {
      await hook.result.current.saveEvents(
        [
          { type: "updated", event: { ...other, title: "edited" } },
          { type: "deleted", id: moved.id },
          {
            type: "added",
            event: {
              ...moved,
              _shared: {
                space: "space-1",
                owner: "owner-1",
                scope: "collection",
                permission: "write",
              },
            },
          },
        ],
        vi.fn(),
      );
    });

    expect(server.store("own").rows.has(moved.id)).toBe(true);
  });
});

describe("a space that stopped accepting my changes", () => {
  it.each(["share_not_found", "share_forbidden", "storage_limit_reached"])(
    "drops the changes after %s so they are not sent forever",
    async (code) => {
      await putSpace(makeEvent());
      session.shares.joined = [joined()];
      const hook = mount();
      const [shared] = (await sync(hook)).filter((e) => e._shared);
      session.post = async (endpoint: string) =>
        endpoint.startsWith("shares/save")
          ? { success: false, code }
          : { success: true };

      const cb = vi.fn();
      await act(async () => {
        await hook.result.current.saveEvents(
          [{ type: "updated", event: { ...shared, title: "x" } }],
          cb,
        );
      });
      expect(cb).toHaveBeenCalledTimes(1);
    },
  );
});

describe("a full storage", () => {
  const refuse = (prefix: string) => {
    const post = server.post;
    session.post = async (endpoint: string, body: unknown) =>
      endpoint.startsWith(prefix)
        ? { success: false, code: "storage_limit_reached" }
        : post(endpoint, body);
  };

  it("is not blamed on a space owner when it is my own", async () => {
    const hook = mount();
    await sync(hook);
    refuse("calendar/events/save");

    const cb = vi.fn();
    await act(async () => {
      await hook.result.current.saveEvents(
        [{ type: "added", event: makeEvent() }],
        cb,
      );
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(t("events.saveFailed"));
    expect(cb).not.toHaveBeenCalled();
  });

  it("is blamed on the owner when I write to their space", async () => {
    await putSpace(makeEvent());
    session.shares.joined = [joined()];
    const hook = mount();
    const [shared] = (await sync(hook)).filter((e) => e._shared);
    refuse("shares/save");

    await act(async () => {
      await hook.result.current.saveEvents(
        [{ type: "updated", event: { ...shared, title: "x" } }],
        vi.fn(),
      );
    });
    expect(toast.error).toHaveBeenCalledWith(t("shares.memberStorageFull"));
  });

  it("is mine to fix when I own the space a member writes to", async () => {
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);
    refuse("shares/save");

    await act(async () => {
      await hook.result.current.saveEvents(
        [{ type: "added", event: makeEvent() }],
        vi.fn(),
      );
    });
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(t("shares.ownerStorageFull")),
    );
  });
});

describe("applySharedChanges for a space shared with me", () => {
  it("decorates what another member changed", async () => {
    session.shares.joined = [joined()];
    const hook = mount();
    await sync(hook);

    const event = makeEvent({ title: "from member" });
    const [record] = await encryptEvents(
      [event],
      spaceKeys.key,
      spaceKeys.bucketKey,
    );
    let result: Awaited<
      ReturnType<typeof hook.result.current.applySharedChanges>
    >;
    await act(async () => {
      result = await hook.result.current.applySharedChanges(
        "space-1",
        [
          {
            type: "added",
            id: record.id,
            data: record.data,
            updatedAt: record.updatedAt,
          },
        ],
        false,
        masterKey,
        bucketKey,
      );
    });
    expect(result!.events[0]).toMatchObject({
      title: "from member",
      _shared: { space: "space-1" },
    });
  });

  it("never lets a member replace or delete my own event", async () => {
    const mine = makeEvent({ title: "mine" });
    await putOwn(mine);
    session.shares.joined = [joined()];
    const hook = mount();
    await sync(hook);

    const [record] = await encryptEvents(
      [{ ...mine, title: "forged", timestamp: mine.timestamp + 1 }],
      spaceKeys.key,
      spaceKeys.bucketKey,
    );
    let result: Awaited<
      ReturnType<typeof hook.result.current.applySharedChanges>
    >;
    await act(async () => {
      result = await hook.result.current.applySharedChanges(
        "space-1",
        [
          {
            type: "updated",
            id: record.id,
            data: record.data,
            updatedAt: record.updatedAt,
          },
          { type: "deleted", id: mine.id },
        ],
        false,
        masterKey,
        bucketKey,
      );
    });

    expect(result!).toEqual({ events: [], deletedIds: [] });
  });

  it("ignores spaces it does not know", async () => {
    const hook = mount();
    let result: Awaited<
      ReturnType<typeof hook.result.current.applySharedChanges>
    >;
    await act(async () => {
      result = await hook.result.current.applySharedChanges(
        "unknown",
        [],
        false,
        masterKey,
        bucketKey,
      );
    });
    expect(result!).toEqual({ events: [], deletedIds: [] });
  });
});

describe("my calendar shared out", () => {
  it("keeps my events a space deletes outside what it covers", async () => {
    const shared = makeEvent({ title: "shared" });
    const other = makeEvent({ title: "other" });
    await putOwn(shared, other);
    session.shares.owned = [owned(shared.id, "item")];
    const hook = mount();
    await sync(hook);

    await act(async () => {
      await hook.result.current.applySharedChanges(
        "space-1",
        [{ type: "deleted", id: other.id }],
        false,
        masterKey,
        bucketKey,
      );
    });

    expect(server.store("own").rows.has(other.id)).toBe(true);
  });

  it("mirrors saved events to the space, and their deletion", async () => {
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);
    const event = makeEvent({ title: "mirrored" });

    await act(async () => {
      await hook.result.current.saveEvents([{ type: "added", event }], vi.fn());
    });
    await vi.waitFor(async () => {
      const [mirrored] = await decryptSaved("space-1", spaceKeys.key);
      expect(mirrored.title).toBe("mirrored");
    });
    expect(server.store("own").rows.has(event.id)).toBe(true);

    await act(async () => {
      await hook.result.current.saveEvents(
        [{ type: "deleted", id: event.id }],
        vi.fn(),
      );
    });
    expect(server.store("space-1").rows.has(event.id)).toBe(false);
  });

  it("does not bring back an event whose deletion has not reached the space", async () => {
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);
    const event = makeEvent({ title: "mirrored" });
    await act(async () => {
      await hook.result.current.saveEvents([{ type: "added", event }], vi.fn());
    });
    await vi.waitFor(() =>
      expect(server.store("space-1").rows.has(event.id)).toBe(true),
    );

    const post = server.post;
    session.post = async (endpoint: string, body: unknown) =>
      endpoint.startsWith("shares/save")
        ? { success: false }
        : post(endpoint, body);
    await act(async () => {
      await hook.result.current.saveEvents(
        [{ type: "deleted", id: event.id }],
        vi.fn(),
      );
    });
    expect(server.store("own").rows.has(event.id)).toBe(false);

    session.post = post;
    emitStream({ type: "sync" });
    const events = await sync(hook);
    expect(events.some((e) => e.id === event.id)).toBe(false);
    expect(server.store("own").rows.has(event.id)).toBe(false);
  });

  it("does not mirror changes that my own calendar refused", async () => {
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);
    const post = server.post;
    session.post = async (endpoint: string, body: unknown) =>
      endpoint.startsWith("calendar/events/save")
        ? { success: false }
        : post(endpoint, body);
    const event = makeEvent({ title: "refused" });

    await act(async () => {
      await hook.result.current.saveEvents([{ type: "added", event }], vi.fn());
    });
    expect(server.store("space-1").rows.has(event.id)).toBe(false);
  });

  it("does not mirror an event that was too large to save", async () => {
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);
    const event = makeEvent({ title: "x".repeat(20_000) });

    await act(async () => {
      await hook.result.current.saveEvents([{ type: "added", event }], vi.fn());
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(server.store("own").rows.has(event.id)).toBe(false);
    expect(server.store("space-1").rows.has(event.id)).toBe(false);
  });

  it("mirrors only the shared event of an item space", async () => {
    const shared = makeEvent({ title: "shared" });
    session.shares.owned = [owned(shared.id, "item")];
    const hook = mount();
    await sync(hook);

    await act(async () => {
      await hook.result.current.saveEvents(
        [
          { type: "added", event: shared },
          { type: "added", event: makeEvent({ title: "private" }) },
        ],
        vi.fn(),
      );
    });

    const mirrored = await decryptSaved("space-1", spaceKeys.key);
    expect(mirrored.map((e) => e.title)).toEqual(["shared"]);
  });

  it("stops sharing an event that gets deleted", async () => {
    const shared = makeEvent({ title: "shared" });
    const other = makeEvent({ title: "other" });
    session.shares.owned = [owned(shared.id, "item")];
    const hook = mount();
    await sync(hook);

    await act(async () => {
      await hook.result.current.saveEvents(
        [{ type: "deleted", id: other.id }],
        vi.fn(),
      );
    });
    expect(session.shares.deleteSpace).not.toHaveBeenCalled();

    await act(async () => {
      await hook.result.current.saveEvents(
        [{ type: "deleted", id: shared.id }],
        vi.fn(),
      );
    });
    expect(session.shares.deleteSpace).toHaveBeenCalledWith("space-1");
  });

  it("uploads what is already there when a space appears", async () => {
    const one = makeEvent({ title: "one" });
    const two = makeEvent({ title: "two" });
    await putOwn(one, two);
    session.shares.owned = [owned(null)];

    mount();
    await vi.waitFor(() => expect(server.store("space-1").rows.size).toBe(2));
  });

  it("does not upload the same events again on a later mount", async () => {
    await putOwn(makeEvent({ title: "one" }), makeEvent({ title: "two" }));
    session.shares.owned = [owned(null)];

    const first = mount();
    await vi.waitFor(() => expect(server.store("space-1").rows.size).toBe(2));
    const uploads = server.saves("space-1").length;
    first.unmount();

    const second = mount();
    await sync(second);
    await vi.waitFor(() => expect(server.requests.length).toBeGreaterThan(0));
    expect(server.saves("space-1")).toHaveLength(uploads);
  });

  it("tries the upload again after it failed", async () => {
    await putOwn(makeEvent({ title: "one" }));
    session.shares.owned = [owned(null)];
    let failures = 0;
    let failing = true;
    session.post = (endpoint, body) => {
      if (!failing || !endpoint.includes("/save?space="))
        return server.post(endpoint, body);
      failures++;
      return { success: false };
    };

    const hook = mount();
    await vi.waitFor(() => expect(failures).toBe(1));
    failing = false;
    session.shares.owned = [owned(null)];
    hook.rerender();

    await vi.waitFor(() => expect(server.store("space-1").rows.size).toBe(1));
  });

  it("stops uploading once the space refuses a chunk for lack of storage", async () => {
    await putOwn(
      ...Array.from({ length: BACKFILL_SAVE_CHUNK + 1 }, () => makeEvent()),
    );
    session.shares.owned = [owned(null)];
    let attempts = 0;
    session.post = (endpoint, body) => {
      if (!endpoint.includes("/save?space="))
        return server.post(endpoint, body);
      attempts++;
      return { success: false, code: "storage_limit_reached" };
    };

    mount();
    await vi.waitFor(() => expect(attempts).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(attempts).toBe(1);
  });

  it("keeps uploading after a chunk made only of events that are too large", async () => {
    const small = makeEvent({ title: "small" });
    await putOwn(
      ...Array.from({ length: BACKFILL_SAVE_CHUNK }, () =>
        makeEvent({ title: "x".repeat(20_000) }),
      ),
      small,
    );
    session.shares.owned = [owned(null)];

    mount();

    await vi.waitFor(() =>
      expect(server.store("space-1").rows.has(small.id)).toBe(true),
    );
  });

  it("uploads this week's events and the recurring ones too", async () => {
    const today = DateTime.now();
    const thisWeek = makeEvent({
      title: "this week",
      start: today,
      end: today.plus({ hours: 1 }),
    });
    const series = makeEvent({
      title: "series",
      start: today.minus({ weeks: 30 }),
      end: today.minus({ weeks: 30 }).plus({ hours: 1 }),
      repeat: { interval: 1, unit: "week" },
    });
    const farAway = makeEvent({
      title: "far away",
      start: today.plus({ weeks: 200 }),
      end: today.plus({ weeks: 200 }).plus({ hours: 1 }),
    });
    await putOwn(thisWeek, series, farAway);
    session.shares.owned = [owned(null)];

    mount();
    await vi.waitFor(() => expect(server.store("space-1").rows.size).toBe(2));
    const titles = (await decryptSaved("space-1", spaceKeys.key)).map(
      (e) => e.title,
    );
    expect(titles.toSorted()).toEqual(["series", "this week"]);
  });

  it("uploads the single event of an item space", async () => {
    const one = makeEvent({ title: "one" });
    await putOwn(one, makeEvent({ title: "other" }));
    const hook = mount();
    await sync(hook);
    session.shares.owned = [owned(one.id, "item")];
    hook.rerender();

    await vi.waitFor(() => expect(server.store("space-1").rows.size).toBe(1));
  });

  it("takes a member's newer edit into my events and saves it", async () => {
    const mine = makeEvent({ title: "mine", timestamp: 1000 });
    await putOwn(mine);
    await putSpace({ ...mine, title: "edited by member", timestamp: 2000 });
    session.shares.owned = [owned(null)];

    const events = await sync(mount());

    expect(events.find((e) => e.id === mine.id)?.title).toBe(
      "edited by member",
    );
    expect(events.find((e) => e.id === mine.id)?._shared).toBeUndefined();
    const [stored] = await decryptSaved("own", masterKey);
    expect(stored.title).toBe("edited by member");
  });

  it("asks the space again when a member's edit could not be saved", async () => {
    const mine = makeEvent({ title: "mine", timestamp: 1000 });
    await putOwn(mine);
    await putSpace({ ...mine, title: "edited by member", timestamp: 2000 });
    session.shares.owned = [owned(null)];
    const hook = mount();
    const post = server.post;
    session.post = async (endpoint: string, body: unknown) =>
      endpoint.startsWith("calendar/events/save")
        ? { success: false }
        : post(endpoint, body);

    const refused = await sync(hook);
    expect(refused.find((e) => e.id === mine.id)?.title).toBe("mine");

    session.post = post;
    const retried = await sync(hook);
    expect(retried.find((e) => e.id === mine.id)?.title).toBe(
      "edited by member",
    );
  });

  it("keeps my event when the space has an older copy", async () => {
    const mine = makeEvent({ title: "mine", timestamp: 3000 });
    await putOwn(mine);
    await putSpace({ ...mine, title: "stale", timestamp: 2000 });
    session.shares.owned = [owned(null)];

    const events = await sync(mount());
    expect(events.find((e) => e.id === mine.id)?.title).toBe("mine");
    expect(server.saves("own")).toHaveLength(0);
    const [stored] = await decryptSaved("own", masterKey);
    expect(stored.title).toBe("mine");
  });

  it("drops my copy of what a member deleted since the last sync", async () => {
    const mine = makeEvent({ title: "mine", timestamp: 1000 });
    const doomed = makeEvent({ title: "doomed", timestamp: 1000 });
    await putOwn(mine, doomed);
    await putSpace(mine, doomed);
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);

    server.store("space-1").rows.delete(doomed.id);
    emitStream({ type: "sync" });
    const events = await sync(hook);

    expect(events.map((e) => e.title)).toEqual(["mine"]);
    expect(server.store("own").rows.has(doomed.id)).toBe(false);
  });

  it("still shows a member's edit when adopting a member's deletion fails", async () => {
    const mine = makeEvent({ title: "mine", timestamp: 1000 });
    const doomed = makeEvent({ title: "doomed", timestamp: 1000 });
    await putOwn(mine, doomed);
    await putSpace(mine, doomed);
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);

    await putSpace({ ...mine, title: "edited by member", timestamp: 2000 });
    server.store("space-1").rows.delete(doomed.id);
    const post = server.post;
    session.post = async (endpoint: string, body: unknown) =>
      endpoint.startsWith("calendar/events/save") &&
      (body as { type: string }[]).some((change) => change.type === "deleted")
        ? { success: false }
        : post(endpoint, body);
    emitStream({ type: "sync" });

    const events = await sync(hook);
    expect(events.find((e) => e.id === mine.id)?.title).toBe(
      "edited by member",
    );
  });

  it("asks the space only about the ids a window reported as gone", async () => {
    const mine = makeEvent({ title: "mine", timestamp: 1000 });
    const doomed = makeEvent({ title: "doomed", timestamp: 1000 });
    await putOwn(mine, doomed);
    await putSpace(mine, doomed);
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);

    server.store("space-1").rows.delete(doomed.id);
    emitStream({ type: "sync" });
    await sync(hook);

    const lookups = server.requests
      .flatMap((r) => (r.body as { parts?: SyncPart[] }).parts ?? [])
      .filter((part) => part.exists);
    expect(lookups).toEqual([{ space: "space-1", exists: [doomed.id] }]);
  });

  it("keeps my event when a member moved it outside the synced window", async () => {
    const mine = makeEvent({ title: "mine", timestamp: 1000 });
    await putOwn(mine);
    await putSpace(mine);
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);

    await putSpace({
      ...mine,
      start: NOW.plus({ weeks: 30 }),
      end: NOW.plus({ weeks: 30, hours: 1 }),
      timestamp: 2000,
    });
    emitStream({ type: "sync" });
    const events = await sync(hook);

    expect(events.map((e) => e.title)).toEqual(["mine"]);
    expect(server.store("own").rows.has(mine.id)).toBe(true);
  });

  it("keeps my event when the space cannot confirm its deletion", async () => {
    const doomed = makeEvent({ title: "doomed", timestamp: 1000 });
    await putOwn(doomed);
    await putSpace(doomed);
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);

    server.store("space-1").rows.delete(doomed.id);
    server.existsFails = true;
    emitStream({ type: "sync" });
    const events = await sync(hook);

    expect(events.map((e) => e.title)).toEqual(["doomed"]);
    expect(server.store("own").rows.has(doomed.id)).toBe(true);
  });

  it("does not ask the space again for a window it already synced", async () => {
    await putOwn(makeEvent());
    await putSpace(makeEvent());
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);
    const asked = () =>
      server.requests
        .filter((r) => r.endpoint === "calendar/events/sync")
        .flatMap((r) => (r.body as { parts: SyncPart[] }).parts)
        .filter((part) => part.space === "space-1");
    const before = asked().length;

    await sync(hook);
    expect(before).toBeGreaterThan(0);
    expect(asked()).toHaveLength(before);

    emitStream({ type: "sync" });
    await sync(hook);
    expect(asked().length).toBeGreaterThan(before);
  });

  it("ignores a member's events outside what the space covers", async () => {
    const shared = makeEvent({ title: "shared" });
    await putOwn(shared);
    await putSpace(makeEvent({ title: "smuggled" }));
    session.shares.owned = [owned(shared.id, "item")];

    const events = await sync(mount());

    expect(events.map((e) => e.title)).toEqual(["shared"]);
    expect(server.saves("own")).toHaveLength(0);
  });

  it("does not mirror what I changed in someone else's calendar into mine", async () => {
    const theirs = makeEvent({ title: "theirs" });
    await putSpace(theirs);
    session.shares.joined = [joined()];
    session.shares.owned = [owned(null, "collection", "space-2")];
    const hook = mount();
    const [shared] = (await sync(hook)).filter((e) => e._shared);

    await act(async () => {
      await hook.result.current.saveEvents(
        [{ type: "updated", event: { ...shared, title: "edited" } }],
        vi.fn(),
      );
    });

    expect(server.saves("space-2")).toHaveLength(0);
    expect(server.store("space-2").rows.size).toBe(0);
  });

  it("adds what a member created", async () => {
    const created = makeEvent({ title: "member made this" });
    await putSpace(created);
    session.shares.owned = [owned(null)];

    const events = await sync(mount());
    expect(events.map((e) => e.title)).toContain("member made this");
    expect(server.store("own").rows.has(created.id)).toBe(true);
  });

  it("does not echo a member edit back into the space", async () => {
    const mine = makeEvent({ timestamp: 1000 });
    await putOwn(mine);
    await putSpace({ ...mine, title: "edited", timestamp: 2000 });
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);
    const before = server.saves("space-1").length;

    await act(async () => {
      await hook.result.current.saveEvents(
        [
          {
            type: "updated",
            event: { ...mine, title: "edited", timestamp: 2000 },
          },
        ],
        vi.fn(),
      );
    });
    expect(server.saves("space-1")).toHaveLength(before);
  });

  it("takes a member's streamed edit and a member's deletion into my events", async () => {
    const mine = makeEvent({ title: "mine", timestamp: 1000 });
    const doomed = makeEvent({ title: "doomed", timestamp: 1000 });
    await putOwn(mine, doomed);
    await putSpace(mine, doomed);
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);

    const [edit] = await encryptEvents(
      [{ ...mine, title: "streamed", timestamp: 5000 }],
      spaceKeys.key,
      spaceKeys.bucketKey,
    );
    let result: Awaited<
      ReturnType<typeof hook.result.current.applySharedChanges>
    >;
    await act(async () => {
      result = await hook.result.current.applySharedChanges(
        "space-1",
        [
          {
            type: "updated",
            id: edit.id,
            data: edit.data,
            updatedAt: edit.updatedAt,
          },
          { type: "deleted", id: doomed.id },
        ],
        false,
        masterKey,
        bucketKey,
      );
    });

    expect(result!.events[0].title).toBe("streamed");
    expect(result!.deletedIds).toEqual([doomed.id]);
    expect(server.store("own").rows.has(doomed.id)).toBe(false);
    const [stored] = await decryptSaved("own", masterKey);
    expect(stored.title).toBe("streamed");
  });

  it("only fills the cache for what this client sent itself", async () => {
    const mine = makeEvent({ timestamp: 1000 });
    await putOwn(mine);
    session.shares.owned = [owned(null)];
    const hook = mount();
    await sync(hook);
    const before = server.saves("own").length;

    const [edit] = await encryptEvents(
      [{ ...mine, title: "own echo", timestamp: 5000 }],
      spaceKeys.key,
      spaceKeys.bucketKey,
    );
    await act(async () => {
      await hook.result.current.applySharedChanges(
        "space-1",
        [
          {
            type: "updated",
            id: edit.id,
            data: edit.data,
            updatedAt: edit.updatedAt,
          },
        ],
        true,
        masterKey,
        bucketKey,
      );
    });
    expect(server.saves("own")).toHaveLength(before);
  });
});

describe("syncing several calendars", () => {
  const syncRequests = () =>
    server.requests.filter((r) => r.endpoint === "calendar/events/sync");

  const partsOf = (request: { body: unknown }) =>
    (request.body as { parts: SyncPart[] }).parts.map((part) => part.space);

  it("asks about my calendar and every space in one request", async () => {
    await putOwn(makeEvent());
    await putSpace(makeEvent());
    session.shares.joined = [joined()];
    session.shares.owned = [owned(null, "collection", "space-2")];
    const hook = mount();
    await sync(hook);
    await vi.waitFor(() =>
      expect(server.store("space-2").rows.size).toBeGreaterThan(0),
    );

    server.requests.length = 0;
    emitStream({ type: "sync" });
    await sync(hook);

    expect(syncRequests()).toHaveLength(1);
    expect(partsOf(syncRequests()[0]).toSorted()).toEqual([
      "space-1",
      "space-2",
      undefined,
    ]);
  });

  it("sends one request for several syncs asked for at the same time", async () => {
    await putOwn(makeEvent());
    const hook = mount();

    await act(async () => {
      const { syncEvents } = hook.result.current;
      const user = { type: "online" } as User;
      await Promise.all([
        syncEvents(user, masterKey, bucketKey, NOW),
        syncEvents(user, masterKey, bucketKey, NOW),
        syncEvents(user, masterKey, bucketKey, NOW),
      ]);
    });

    expect(syncRequests()).toHaveLength(1);
  });

  it("still returns my events when a space is gone", async () => {
    const mine = makeEvent();
    await putOwn(mine);
    session.shares.joined = [{ ...joined(), id: "gone" }];
    const hook = mount();
    const post = server.post;
    session.post = async (endpoint: string, body: unknown) => {
      const res = await post(endpoint, body);
      if (endpoint !== "calendar/events/sync") return res;

      const parts = (res.data as { parts: object[] }).parts;
      return {
        success: true,
        data: {
          parts: parts.map((part, i) =>
            (body as { parts: SyncPart[] }).parts[i].space === "gone"
              ? { success: false, code: "share_not_found" }
              : part,
          ),
        },
      };
    };

    const events = await sync(hook);

    expect(events.map((e) => e.id)).toEqual([mine.id]);
  });
});

describe("expanded search", () => {
  it("also reaches the shared calendars", async () => {
    await putSpace(makeEvent({ title: "shared far away" }));
    session.shares.joined = [joined()];
    const hook = mount();

    let events: CalendarEvent[] = [];
    await act(async () => {
      events = await hook.result.current.syncExpanded(
        NOW,
        masterKey,
        bucketKey,
        -1,
        4,
      );
    });
    expect(events.map((e) => e.title)).toEqual(["shared far away"]);
  });

  it("returns my own events too and asks for them together with the spaces", async () => {
    const mine = makeEvent({ title: "mine far away" });
    await putOwn(mine);
    await putSpace(makeEvent({ title: "shared far away" }));
    session.shares.joined = [joined()];
    const hook = mount();

    let events: CalendarEvent[] = [];
    await act(async () => {
      events = await hook.result.current.syncExpanded(
        NOW,
        masterKey,
        bucketKey,
        -1,
        4,
      );
    });

    expect(events.map((e) => e.title).toSorted()).toEqual([
      "mine far away",
      "shared far away",
    ]);
    const requests = server.requests.filter(
      (r) => r.endpoint === "calendar/events/sync",
    );
    expect(requests).toHaveLength(1);
    expect(
      (requests[0].body as { parts: SyncPart[] }).parts.map((p) => p.space),
    ).toEqual([undefined, "space-1"]);
  });

  it("fails when my own calendar cannot be synced", async () => {
    session.shares.joined = [joined()];
    const hook = mount();
    session.post = async () => ({ success: false });

    await act(async () => {
      await expect(
        hook.result.current.syncExpanded(NOW, masterKey, bucketKey, -1, 4),
      ).rejects.toThrow();
    });
  });
});

void computeSyncRangeBuckets;
