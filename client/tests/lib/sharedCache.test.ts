import { describe, expect, it } from "vitest";
import { createEventCache } from "../../src/lib/calendar/eventCache";
import { pruneSharedCaches, sharedCacheName } from "../../src/lib/sharedCache";

const names = async () => (await indexedDB.databases()).map((db) => db.name);

describe("pruneSharedCaches", () => {
  it("deletes the caches of other spaces, even while one is open, and nothing else", async () => {
    const open = createEventCache(sharedCacheName("gone"));
    await open.clear();
    await createEventCache(sharedCacheName("kept")).clear();
    await createEventCache().clear();

    await pruneSharedCaches(new Set(["kept"]));

    await expect.poll(names).not.toContain(sharedCacheName("gone"));
    expect(await names()).toEqual(
      expect.arrayContaining([sharedCacheName("kept"), "acLifeEventCache"]),
    );
  });

  it("lets a deleted cache be opened again", async () => {
    const cache = createEventCache(sharedCacheName("back"));
    await cache.clear();
    await pruneSharedCaches(new Set());
    await expect.poll(names).not.toContain(sharedCacheName("back"));

    await expect(cache.clear()).resolves.toBeUndefined();
    expect(await names()).toContain(sharedCacheName("back"));
  });
});
