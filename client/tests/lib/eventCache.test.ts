import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
import { encryptEvents } from "../../src/lib/calendar/crypt.ts";
import {
  createEventCache,
  type CacheUpsert,
} from "../../src/lib/calendar/eventCache.ts";

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
const eventAt = (n: number, title: string, weeks = 0, timestamp = 1000) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  title,
  start: start.plus({ weeks }),
  end: start.plus({ weeks, hours: 1 }),
  timestamp,
});

const upsertOf = async (event: CalendarEvent): Promise<CacheUpsert> => {
  const [enc] = await encryptEvents([event], masterKey, bucketKey);
  return {
    id: enc.id,
    data: enc.data,
    updatedAt: enc.updatedAt,
    buckets: enc.buckets!,
    event,
  };
};

const storedBuckets = () =>
  new Promise<IDBValidKey[]>((resolve) => {
    const open = indexedDB.open("acLifeEventCache");
    open.onsuccess = () => {
      const req = open.result
        .transaction("buckets")
        .objectStore("buckets")
        .getAllKeys();
      req.onsuccess = () => resolve(req.result);
    };
  });

const indexOf = async (
  cache: ReturnType<typeof createEventCache>,
  ids: string[],
) => Object.fromEntries(await cache.readIndex(ids, masterKey));

describe("event cache", () => {
  it("stores events and lists them per bucket", async () => {
    const cache = createEventCache();
    const a = await upsertOf(eventAt(1, "a"));
    const b = await upsertOf(eventAt(2, "b"));

    await cache.apply([a, b], [], masterKey);

    expect(await indexOf(cache, a.buckets)).toEqual({
      [a.buckets[0]]: [
        { id: a.id, ts: 1000 },
        { id: b.id, ts: 1000 },
      ],
    });
    const events = await cache.events([a.id, b.id], masterKey);
    expect(events.map((e) => e.title)).toEqual(["a", "b"]);
  });

  it("moves an updated event to its new buckets and drops emptied ones", async () => {
    const cache = createEventCache();
    const before = await upsertOf(eventAt(1, "a"));
    const after = await upsertOf(eventAt(1, "a", 2, 2000));
    await cache.apply([before], [], masterKey);

    await cache.apply([after], [], masterKey);

    expect(await indexOf(cache, before.buckets)).toEqual({
      [before.buckets[0]]: [],
    });
    expect(await indexOf(cache, after.buckets)).toEqual({
      [after.buckets[0]]: [{ id: after.id, ts: 2000 }],
    });
    expect((await cache.records([after.id]))[0].updatedAt).toBe(2000);
    expect(await storedBuckets()).toEqual(after.buckets);
  });

  it("removes deleted events from the store and the index", async () => {
    const cache = createEventCache();
    const a = await upsertOf(eventAt(1, "a"));
    const b = await upsertOf(eventAt(2, "b"));
    await cache.apply([a, b], [], masterKey);

    await cache.apply([], [a.id], masterKey);

    expect(await indexOf(cache, a.buckets)).toEqual({
      [a.buckets[0]]: [{ id: b.id, ts: 1000 }],
    });
    expect(await cache.records([a.id, b.id])).toHaveLength(1);
  });

  it("keeps event content out of everything it stores", async () => {
    const cache = createEventCache();
    await cache.apply(
      [await upsertOf({ ...eventAt(1, "Dentist"), description: "Molar" })],
      [],
      masterKey,
    );

    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("acLifeEventCache");
      req.onsuccess = () => resolve(req.result);
    });
    const dump = await Promise.all(
      ["events", "buckets"].map(
        (store) =>
          new Promise<unknown[]>((resolve) => {
            const req = db.transaction(store).objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result);
          }),
      ),
    );
    const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
    const stored = [
      ...(dump[0] as { data: string }[]).map((e) =>
        latin1(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0))),
      ),
      ...(dump[1] as ArrayBuffer[]).map((b) => latin1(new Uint8Array(b))),
      JSON.stringify(dump[0]),
    ].join("\n");

    expect(stored).not.toContain("Dentist");
    expect(stored).not.toContain("Molar");
  });

  it("hands out the same event object until it changes", async () => {
    const cache = createEventCache();
    const a = await upsertOf(eventAt(1, "a"));
    await cache.apply([a], [], masterKey);
    const first = (await createEventCache().events([a.id], masterKey))[0];

    const [x] = await cache.events([a.id], masterKey);
    const [y] = await cache.events([a.id], masterKey);
    expect(x).toBe(y);
    expect(x).not.toBe(first);

    await cache.apply([await upsertOf(eventAt(1, "b", 0, 2000))], [], masterKey);
    expect((await cache.events([a.id], masterKey))[0].title).toBe("b");
  });

  it("fails to read an index written with another key", async () => {
    const cache = createEventCache();
    const a = await upsertOf(eventAt(1, "a"));
    await cache.apply([a], [], masterKey);
    const other = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    await expect(cache.readIndex(a.buckets, other)).rejects.toBeDefined();
  });

  it("clears everything", async () => {
    const cache = createEventCache();
    const a = await upsertOf(eventAt(1, "a"));
    await cache.apply([a], [], masterKey);

    await cache.clear();

    expect(await cache.allEvents(masterKey)).toEqual([]);
    expect(await indexOf(cache, a.buckets)).toEqual({ [a.buckets[0]]: [] });
  });
});
