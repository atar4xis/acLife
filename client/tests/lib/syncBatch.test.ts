import { describe, expect, it, vi } from "vitest";
import { MAX_SYNC_PARTS, syncPart } from "../../src/lib/syncBatch.ts";
import type { APIResponse } from "../../src/types/API.ts";

type Body = { parts: { space?: string; n?: number }[] };

const answering = () =>
  vi.fn(async (_path: string, body: unknown) => ({
    success: true,
    data: {
      parts: (body as Body).parts.map((part) => ({
        success: true,
        data: { echo: part.n },
      })),
    },
  }));

const asPost = (post: ReturnType<typeof answering>) =>
  post as unknown as Parameters<typeof syncPart>[0];

describe("syncPart", () => {
  it("sends the parts of one window as a single request and answers each caller", async () => {
    const post = answering();
    const results = await Promise.all([
      syncPart(asPost(post), "journal/sync", undefined, { n: 1 }),
      syncPart(asPost(post), "journal/sync", "space-a", { n: 2 }),
      syncPart(asPost(post), "journal/sync", "space-b", { n: 3 }),
    ]);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]).toEqual([
      "journal/sync",
      {
        parts: [
          { n: 1, space: undefined },
          { n: 2, space: "space-a" },
          { n: 3, space: "space-b" },
        ],
      },
    ]);
    expect(results.map((r) => r.data)).toEqual([
      { echo: 1 },
      { echo: 2 },
      { echo: 3 },
    ]);
  });

  it("keeps different endpoints apart", async () => {
    const post = answering();
    await Promise.all([
      syncPart(asPost(post), "journal/sync", undefined, { n: 1 }),
      syncPart(asPost(post), "calendar/events/sync", undefined, { n: 2 }),
    ]);

    expect(post.mock.calls.map(([path]) => path).sort()).toEqual([
      "calendar/events/sync",
      "journal/sync",
    ]);
  });

  it("sends a second request for the same space instead of a duplicate part", async () => {
    const post = answering();
    const results = await Promise.all([
      syncPart(asPost(post), "journal/sync", "space-a", { n: 1 }),
      syncPart(asPost(post), "journal/sync", "space-a", { n: 2 }),
    ]);

    expect(post).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.data)).toEqual([{ echo: 1 }, { echo: 2 }]);
  });

  it("never sends more parts than the server accepts", async () => {
    const post = answering();
    const results = await Promise.all(
      Array.from({ length: MAX_SYNC_PARTS + 3 }, (_, n) =>
        syncPart<{ echo: number }>(asPost(post), "journal/sync", `s${n}`, {
          n,
        }),
      ),
    );

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][1]).toMatchObject({
      parts: { length: MAX_SYNC_PARTS },
    });
    expect(results.map((r) => r.data?.echo)).toEqual(
      results.map((_, n) => n),
    );
  });

  it("lets one failing part leave the others alone", async () => {
    const post = vi.fn(async () => ({
      success: true,
      data: {
        parts: [
          { success: true, data: "fine" },
          { success: false, code: "share_not_found" },
        ],
      },
    }));
    const [own, gone] = await Promise.all([
      syncPart(asPost(post as never), "journal/sync", undefined, {}),
      syncPart(asPost(post as never), "journal/sync", "space-a", {}),
    ]);

    expect(own).toEqual({ success: true, data: "fine" });
    expect(gone).toEqual({ success: false, code: "share_not_found" });
  });

  it("fails every caller of a rejected request", async () => {
    const post = vi.fn(async (): Promise<APIResponse<unknown>> => ({
      success: false,
      code: "invalid_subscription",
      message: "nope",
    }));
    const results = await Promise.all([
      syncPart(asPost(post as never), "journal/sync", undefined, {}),
      syncPart(asPost(post as never), "journal/sync", "space-a", {}),
    ]);

    expect(results.map((r) => [r.success, r.code])).toEqual([
      [false, "invalid_subscription"],
      [false, "invalid_subscription"],
    ]);
  });

  it("fails the caller when post throws synchronously", async () => {
    const post = vi.fn(() => {
      throw new Error("broken");
    });
    const result = await syncPart(
      asPost(post as never),
      "journal/sync",
      undefined,
      {},
    );

    expect(result).toMatchObject({ success: false, message: "broken" });
  });

  it("fails every caller when the request throws", async () => {
    const post = vi.fn(async () => {
      throw new Error("offline");
    });
    const [a, b] = await Promise.all([
      syncPart(asPost(post as never), "journal/sync", undefined, {}),
      syncPart(asPost(post as never), "journal/sync", "space-a", {}),
    ]);

    expect([a.success, a.message, b.success]).toEqual([false, "offline", false]);
  });

  it("fails a part the server did not answer", async () => {
    const post = vi.fn(async () => ({
      success: true,
      data: { parts: [{ success: true, data: 1 }] },
    }));
    const [a, b] = await Promise.all([
      syncPart(asPost(post as never), "journal/sync", undefined, {}),
      syncPart(asPost(post as never), "journal/sync", "space-a", {}),
    ]);

    expect([a.success, b.success]).toEqual([true, false]);
  });

  it("opens a new window after a flush", async () => {
    const post = answering();
    await syncPart(asPost(post), "journal/sync", undefined, { n: 1 });
    await syncPart(asPost(post), "journal/sync", undefined, { n: 2 });

    expect(post).toHaveBeenCalledTimes(2);
  });
});
