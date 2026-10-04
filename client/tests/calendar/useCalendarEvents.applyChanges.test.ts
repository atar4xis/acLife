import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { DateTime } from "luxon";
import type { User } from "../../src/types/User.ts";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
import type { CalendarChange } from "../../src/lib/stream.ts";

const store = vi.hoisted(() => ({ cached: undefined as unknown }));
const postMock = vi.hoisted(() => vi.fn());

const storageMock = vi.hoisted(() => ({
  get: vi.fn(() => store.cached),
  set: vi.fn((_key: string, value: unknown) => {
    store.cached = value;
  }),
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({ post: postMock }),
}));

// jsdom's Blob has no .stream(), which the real gzip helpers need, so pass bytes through unchanged
vi.mock("../../src/lib/gzip.ts", () => ({
  compress: async (input: Uint8Array) => input,
  decompress: async (input: Uint8Array) => input,
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ ready: true, ...storageMock }),
}));

const { useCalendarEvents } = await import(
  "../../src/hooks/calendar/useCalendarEvents.ts"
);
const { encryptEvents, encryptOfflineEvents, decryptOfflineEvents } =
  await import("../../src/lib/calendar/crypt.ts");

const masterKey = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt", "decrypt"],
);
const bucketKey = await crypto.subtle.generateKey(
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);

const start = DateTime.fromISO("2026-03-10T10:00:00Z", { zone: "utc" });
const eventWith = (n: number, title: string, timestamp: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  start,
  end: start.plus({ hours: 1 }),
  title,
  timestamp,
});

const upsert = async (
  type: "added" | "updated",
  event: CalendarEvent,
): Promise<CalendarChange> => {
  const [encrypted] = await encryptEvents([event], masterKey, bucketKey);
  return {
    type,
    id: encrypted.id,
    data: encrypted.data,
    updatedAt: encrypted.updatedAt,
  };
};

const cachedEvents = async () =>
  (await decryptOfflineEvents(
    store.cached as Parameters<typeof decryptOfflineEvents>[0],
    masterKey,
  )) as CalendarEvent[];

const setup = async (...existing: CalendarEvent[]) => {
  store.cached = await encryptOfflineEvents(existing, masterKey);
  storageMock.set.mockClear();
  return renderHook(() =>
    useCalendarEvents({ type: "online" } as User, masterKey, bucketKey),
  ).result;
};

describe("applyChanges", () => {
  beforeEach(() => {
    store.cached = undefined;
    postMock.mockReset();
  });

  it("adds a new event and caches it", async () => {
    const result = await setup();
    const incoming = eventWith(1, "new", 5000);

    const events = await result.current.applyChanges(
      [await upsert("added", incoming)],
      masterKey,
    );

    expect(events.map((e) => [e.id, e.title, e.timestamp])).toEqual([
      [incoming.id, "new", 5000],
    ]);
    expect((await cachedEvents()).map((e) => e.title)).toEqual(["new"]);
  });

  it("replaces an event with a newer version", async () => {
    const result = await setup(eventWith(1, "old", 1000));

    const events = await result.current.applyChanges(
      [await upsert("updated", eventWith(1, "newer", 2000))],
      masterKey,
    );

    expect(events.map((e) => [e.title, e.timestamp])).toEqual([["newer", 2000]]);
    expect((await cachedEvents())[0].title).toBe("newer");
  });

  it("keeps the cached event when the change is older or equal", async () => {
    const result = await setup(eventWith(1, "current", 2000));

    const events = await result.current.applyChanges(
      [
        await upsert("updated", eventWith(1, "older", 1000)),
        await upsert("updated", eventWith(1, "same", 2000)),
      ],
      masterKey,
    );

    expect(events.map((e) => e.title)).toEqual(["current"]);
  });

  it("removes deleted events and leaves the others", async () => {
    const result = await setup(eventWith(1, "a", 1000), eventWith(2, "b", 1000));

    const events = await result.current.applyChanges(
      [{ type: "deleted", id: eventWith(1, "a", 0).id }],
      masterKey,
    );

    expect(events.map((e) => e.title)).toEqual(["b"]);
    expect((await cachedEvents()).map((e) => e.title)).toEqual(["b"]);
  });

  it("applies changes in order, so a delete does not hide a later upsert of the same event", async () => {
    const result = await setup(eventWith(1, "old", 1000));

    const events = await result.current.applyChanges(
      [
        { type: "deleted", id: eventWith(1, "", 0).id },
        await upsert("updated", eventWith(1, "back", 2000)),
      ],
      masterKey,
    );

    expect(events.map((e) => e.title)).toEqual(["back"]);
  });

  it("works with an empty cache", async () => {
    const result = await setup();
    store.cached = undefined;

    const events = await result.current.applyChanges(
      [await upsert("added", eventWith(1, "first", 1000))],
      masterKey,
    );

    expect(events).toHaveLength(1);
  });

  it("rejects when a change cannot be decrypted, leaving the cache alone", async () => {
    const result = await setup(eventWith(1, "kept", 1000));
    const before = store.cached;

    await expect(
      result.current.applyChanges(
        [
          {
            type: "updated",
            id: eventWith(2, "", 0).id,
            data: "bm90IGVuY3J5cHRlZCBhdCBhbGw=",
            updatedAt: 5000,
          },
        ],
        masterKey,
      ),
    ).rejects.toBeDefined();

    expect(store.cached).toBe(before);
  });

  it("does not lose changes applied at the same time", async () => {
    const result = await setup();

    await Promise.all([
      result.current.applyChanges(
        [await upsert("added", eventWith(1, "first", 1000))],
        masterKey,
      ),
      result.current.applyChanges(
        [await upsert("added", eventWith(2, "second", 1000))],
        masterKey,
      ),
    ]);

    expect((await cachedEvents()).map((e) => e.title).sort()).toEqual([
      "first",
      "second",
    ]);
  });

  it("keeps working after a failed change", async () => {
    const result = await setup();

    await result.current
      .applyChanges(
        [{ type: "added", id: "x", data: "AAAA", updatedAt: 1 }],
        masterKey,
      )
      .catch(() => {});
    const events = await result.current.applyChanges(
      [await upsert("added", eventWith(1, "after", 1000))],
      masterKey,
    );

    expect(events.map((e) => e.title)).toEqual(["after"]);
  });

  describe("while another cache writer is running", () => {
    const gatedSync = (
      result: Awaited<ReturnType<typeof setup>>,
    ): { release: () => void; sync: Promise<unknown> } => {
      let release!: () => void;
      const gate = new Promise((resolve) => {
        release = () => resolve({ success: true, data: { mismatched: [] } });
      });
      postMock.mockImplementation((path: string) =>
        path === "calendar/events/sync"
          ? gate
          : Promise.resolve({ success: true }),
      );
      return {
        release: () => release(),
        sync: result.current.syncBuckets(["YnVja2V0"], masterKey, bucketKey),
      };
    };

    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    it("applyChanges waits for a sync in flight", async () => {
      const result = await setup(eventWith(1, "a", 1000));
      const change = await upsert("added", eventWith(2, "b", 1000));
      const { release, sync } = gatedSync(result);

      const applied = result.current.applyChanges([change], masterKey);
      await settle();
      expect(storageMock.set).not.toHaveBeenCalled();

      release();
      await sync;
      expect((await applied).map((e) => e.title).sort()).toEqual(["a", "b"]);
    });

    it("saveEvents completes without touching the cache, which the stream fills in", async () => {
      const result = await setup(eventWith(1, "a", 1000));
      const { release, sync } = gatedSync(result);
      const done = vi.fn();

      await result.current.saveEvents(
        [{ type: "added", event: eventWith(2, "b", 1000) }],
        done,
      );

      expect(done).toHaveBeenCalledTimes(1);
      expect(storageMock.set).not.toHaveBeenCalled();
      expect((await cachedEvents()).map((e) => e.title)).toEqual(["a"]);

      release();
      await sync;
    });
  });

  it("drops the result when the key changed while it was running", async () => {
    store.cached = await encryptOfflineEvents(
      [eventWith(1, "a", 1000)],
      masterKey,
    );
    storageMock.set.mockClear();
    const change = await upsert("added", eventWith(2, "late", 1000));
    const otherKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const { result, rerender } = renderHook(
      ({ key }) =>
        useCalendarEvents({ type: "online" } as User, key, bucketKey),
      { initialProps: { key: masterKey } },
    );
    let release!: () => void;
    postMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ success: true, data: { mismatched: [] } });
        }),
    );
    const sync = result.current.syncBuckets(["YnVja2V0"], masterKey, bucketKey);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const applied = result.current.applyChanges([change], masterKey);
    rerender({ key: otherKey });
    release();
    await sync;
    await applied;

    expect(storageMock.set).not.toHaveBeenCalled();
  });

  describe("saveEvents", () => {
    const savedTypes: string[] = [];
    let releaseFirst!: () => void;

    const gateFirstSave = () => {
      savedTypes.length = 0;
      const gate = new Promise((resolve) => {
        releaseFirst = () => resolve({ success: true });
      });
      postMock.mockImplementation((path: string, body: { type: string }[]) => {
        if (!path.startsWith("calendar/events/save")) return {};
        savedTypes.push(body[0].type);
        return savedTypes.length === 1 ? gate : { success: true };
      });
    };

    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    it("sends one save at a time, in the order they were made", async () => {
      const result = await setup();
      gateFirstSave();
      const event = eventWith(1, "a", 1000);

      const first = result.current.saveEvents(
        [{ type: "added", event }],
        () => {},
      );
      const second = result.current.saveEvents(
        [{ type: "deleted", id: event.id }],
        () => {},
      );
      await settle();
      expect(savedTypes).toEqual(["added"]);

      releaseFirst();
      await Promise.all([first, second]);
      expect(savedTypes).toEqual(["added", "deleted"]);
    });

    it("sends the next save even when the earlier one was rejected", async () => {
      const result = await setup();
      savedTypes.length = 0;
      postMock.mockImplementation((path: string, body: { type: string }[]) => {
        if (!path.startsWith("calendar/events/save")) return {};
        savedTypes.push(body[0].type);
        return savedTypes.length === 1
          ? Promise.reject(new Error("offline"))
          : { success: true };
      });
      const event = eventWith(1, "a", 1000);

      await result.current.saveEvents([{ type: "added", event }], () => {});
      await result.current.saveEvents(
        [{ type: "deleted", id: event.id }],
        () => {},
      );

      expect(savedTypes).toEqual(["added", "deleted"]);
    });
  });
});
