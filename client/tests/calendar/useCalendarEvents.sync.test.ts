import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { DateTime } from "luxon";
import type { User } from "../../src/types/User.ts";

const storageMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

const apiMock = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => apiMock,
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
const { encryptOfflineEvents } = await import(
  "../../src/lib/calendar/crypt.ts"
);
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
  storageMock.get.mockReturnValue(
    await encryptOfflineEvents([event], masterKey),
  );
  const bucket = await computeBucketId(bucketKey, weekLabel(start));
  const { result } = renderHook(() =>
    useCalendarEvents({ type: "online" } as User, masterKey, bucketKey),
  );
  return { result, masterKey, bucketKey, bucket };
};

describe("syncBuckets", () => {
  it("sends only hashes and skips the cache rewrite when nothing differs", async () => {
    const { result, masterKey, bucketKey, bucket } = await setup();
    storageMock.set.mockClear();
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
    expect(storageMock.set).not.toHaveBeenCalled();
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
        data: { added: [], updated: [], deleted: [], needsBucketBackfill: [] },
      });

    await result.current.syncBuckets([bucket, other], masterKey, bucketKey);

    expect(apiMock.post).toHaveBeenCalledTimes(2);
    const body = apiMock.post.mock.calls[1][1];
    expect(body.buckets).toEqual([bucket]);
    expect(body.events).toHaveLength(1);
  });

  it("re-saves events of mismatched buckets when the server has nothing to apply", async () => {
    const { result, masterKey, bucketKey, bucket } = await setup();
    apiMock.post
      .mockReset()
      .mockResolvedValueOnce({ success: true, data: { mismatched: [bucket] } })
      .mockResolvedValueOnce({
        success: true,
        data: { added: [], updated: [], deleted: [], needsBucketBackfill: [] },
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
          deleted: ["AAAAAAAAAAAAAAAAAAAAAA=="],
          needsBucketBackfill: [],
        },
      })
      .mockResolvedValue({ success: true });

    await result.current.syncBuckets([bucket], masterKey, bucketKey);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(apiMock.post).toHaveBeenCalledTimes(2);
  });
});
