import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { DateTime } from "luxon";
import type { User } from "../../src/types/User.ts";

const apiMock = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => apiMock,
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ ready: true, get: vi.fn(), set: vi.fn() }),
}));

const { useCalendarEvents } = await import(
  "../../src/hooks/calendar/useCalendarEvents.ts"
);
const { seedCache, cachedEvents } = await import("./eventCacheHelpers.ts");
const { encryptEvents } = await import("../../src/lib/calendar/crypt.ts");
const { computeBucketId, weekLabel } = await import(
  "../../src/lib/calendar/buckets.ts"
);

const setup = async () => {
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
  const event = {
    id: "00000000-0000-4000-8000-000000000001",
    start,
    end: start.plus({ hours: 1 }),
    title: "a",
    timestamp: 1790000000001,
  };
  await seedCache([event], masterKey, bucketKey);
  const bucket = await computeBucketId(bucketKey, weekLabel(start));
  const { result } = renderHook(() =>
    useCalendarEvents({ type: "online" } as User, masterKey, bucketKey),
  );
  return { result, masterKey, bucketKey, bucket };
};

describe("syncBuckets", () => {
  it("sends only hashes and skips the cache rewrite when nothing differs", async () => {
    const { result, masterKey, bucketKey, bucket } = await setup();
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    apiMock.post.mockReset().mockResolvedValue({
      success: true,
      data: { mismatched: [] },
    });

    const events = await result.current.syncBuckets(
      [bucket],
      masterKey,
      bucketKey,
    );

    expect(events).toHaveLength(1);
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    const body = apiMock.post.mock.calls[0][1];
    expect(Object.keys(body)).toEqual(["hashes"]);
    expect(Object.keys(body.hashes)).toEqual([bucket]);
    expect(put).not.toHaveBeenCalled();
    put.mockRestore();
  });

  it("sends ids only for mismatched buckets", async () => {
    const { result, masterKey, bucketKey, bucket } = await setup();
    const other = "b3RoZXI=";
    apiMock.post
      .mockReset()
      .mockResolvedValueOnce({
        success: true,
        data: { mismatched: [bucket] },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { added: [], updated: [], deleted: [] },
      });

    await result.current.syncBuckets([bucket, other], masterKey, bucketKey);

    expect(Object.keys(apiMock.post.mock.calls[0][1].hashes)).toEqual([
      bucket,
      other,
    ]);
    const body = apiMock.post.mock.calls[1][1];
    expect(body.buckets).toEqual([bucket]);
    expect(body.records).toHaveLength(1);
  });

  it("re-saves events of mismatched buckets when the server has nothing to apply", async () => {
    const { result, masterKey, bucketKey, bucket } = await setup();
    apiMock.post
      .mockReset()
      .mockResolvedValueOnce({ success: true, data: { mismatched: [bucket] } })
      .mockResolvedValueOnce({
        success: true,
        data: { added: [], updated: [], deleted: [] },
      })
      .mockResolvedValue({ success: true });

    await result.current.syncBuckets([bucket], masterKey, bucketKey);

    await vi.waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(3));
    const [path, changes] = apiMock.post.mock.calls[2];
    expect(path).toBe("calendar/events/save");
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe("updated");
  });

  it("does not re-save when the server returned changes", async () => {
    const { result, masterKey, bucketKey, bucket } = await setup();
    apiMock.post
      .mockReset()
      .mockResolvedValueOnce({ success: true, data: { mismatched: [bucket] } })
      .mockResolvedValueOnce({
        success: true,
        data: {
          added: [],
          updated: [],
          deleted: ["AAAAAAAAAAAAAAAAAAAAAA=="]
        },
      })
      .mockResolvedValue({ success: true });

    await result.current.syncBuckets([bucket], masterKey, bucketKey);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(apiMock.post).toHaveBeenCalledTimes(2);
  });

  it("returns only the events of the requested buckets", async () => {
    const { result, masterKey, bucketKey, bucket } = await setup();
    const farStart = DateTime.fromISO("2026-09-10T10:00:00Z", { zone: "utc" });
    await seedCache(
      [
        {
          id: "00000000-0000-4000-8000-000000000002",
          start: farStart,
          end: farStart.plus({ hours: 1 }),
          title: "far",
          timestamp: 1790000000002,
        },
      ],
      masterKey,
      bucketKey,
    );
    apiMock.post.mockReset().mockResolvedValue({
      success: true,
      data: { mismatched: [] },
    });

    const events = await result.current.syncBuckets(
      [bucket],
      masterKey,
      bucketKey,
    );

    expect(events.map((e) => e.title)).toEqual(["a"]);
  });

  it("pulls everything again when the cache cannot be read with the key", async () => {
    const { result, masterKey, bucketKey, bucket } = await setup();
    const otherKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    apiMock.post.mockReset().mockResolvedValue({
      success: true,
      data: { added: [], updated: [], deleted: [] },
    });

    await result.current.syncBuckets([bucket], otherKey, bucketKey);

    expect(apiMock.post).toHaveBeenCalledTimes(1);
    expect(apiMock.post.mock.calls[0][1].records).toEqual([]);
    expect(toast.warning).toHaveBeenCalled();
    expect(await cachedEvents(masterKey)).toEqual([]);
  });

  it("returns and caches the events the server sent", async () => {
    const { result, masterKey, bucketKey, bucket } = await setup();
    const start = DateTime.fromISO("2026-03-10T12:00:00Z", { zone: "utc" });
    const [pulled] = await encryptEvents(
      [
        {
          id: "00000000-0000-4000-8000-000000000003",
          start,
          end: start.plus({ hours: 1 }),
          title: "pulled",
          timestamp: 1790000000003,
        },
      ],
      masterKey,
      bucketKey,
    );
    apiMock.post
      .mockReset()
      .mockResolvedValueOnce({ success: true, data: { mismatched: [bucket] } })
      .mockResolvedValueOnce({
        success: true,
        data: {
          added: [
            { id: pulled.id, data: pulled.data, updatedAt: pulled.updatedAt },
          ],
          updated: [],
          deleted: [],
        },
      });

    const events = await result.current.syncBuckets(
      [bucket],
      masterKey,
      bucketKey,
    );

    expect(events.map((e) => e.title).sort()).toEqual(["a", "pulled"]);
    expect((await cachedEvents(masterKey)).map((e) => e.title).sort()).toEqual([
      "a",
      "pulled",
    ]);
  });
});
