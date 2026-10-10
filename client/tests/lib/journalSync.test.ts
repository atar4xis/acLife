import { describe, expect, it } from "vitest";
import {
  diffBuckets,
  journalBucket,
  journalHashTable,
  mergeRemote,
  pendingChanges,
} from "../../src/lib/journal/sync.ts";
import { computeBucketHash } from "../../src/lib/bucketHash.ts";
import type { JournalItem } from "../../src/types/Journal.ts";

const item = (id: string, updatedAt: number, name = id): JournalItem => ({
  id,
  type: "note",
  parentId: null,
  name,
  content: "",
  createdAt: 0,
  updatedAt,
});

const A = "0a000001-0000-4000-8000-000000000001";
const B = "0a000002-0000-4000-8000-000000000002";
const C = "ff000003-0000-4000-8000-000000000003";

describe("journalBucket", () => {
  it("is the lowercase first two characters of the id", () => {
    expect(journalBucket(A)).toBe("0a");
    expect(journalBucket("FF000003-0000-4000-8000-000000000003")).toBe("ff");
  });
});

describe("journalHashTable", () => {
  const items = [
    item(A, 1790000000001),
    item(B, 1790000000002),
    item(C, 1790000000003),
  ];

  it("has 256 fixed width slices in bucket order that match the server", async () => {
    const table = await journalHashTable(items);

    expect(table).toHaveLength(256 * 11);
    expect(table.slice(0, 11)).toBe("47DEQpj8HBS");
    expect(table.slice(10 * 11, 11 * 11)).toBe("98EYD9vIHgR");
    expect(table.slice(255 * 11)).toBe("l0Srlf6SJrf");
    expect(table.slice(1 * 11, 2 * 11)).toBe("47DEQpj8HBS");
  });

  it("does not depend on the item order or id case", async () => {
    const shuffled = [
      item(C.toUpperCase(), 1790000000003),
      items[1],
      items[0],
    ];

    expect(await journalHashTable(shuffled)).toBe(
      await journalHashTable(items),
    );
  });

  it("uses the same hash as the global one", async () => {
    expect(
      await computeBucketHash(
        items.map((i) => ({ id: i.id, ts: i.updatedAt })),
      ),
    ).toBe("/NLIUCmw4xQVL3oNxAJWHWnsqviBQ59vZmdJE5lsdK4=");
  });
});

describe("diffBuckets", () => {
  it("lists the buckets whose slice differs, in order", async () => {
    const local = await journalHashTable([item(A, 1), item(C, 3)]);
    const server = await journalHashTable([item(A, 2), item(C, 3), item(B, 4)]);

    expect(diffBuckets(local, server)).toEqual(["0a"]);
    expect(diffBuckets(await journalHashTable([]), server)).toEqual([
      "0a",
      "ff",
    ]);
    expect(diffBuckets(server, server)).toEqual([]);
  });
});

describe("diffBuckets slices", () => {
  it("compares every character of a slice and nothing beyond it", () => {
    const rest = "x".repeat(255 * 11);
    const table = (slice: string) => slice + rest;

    expect(diffBuckets(table("abcdefghij1"), table("abcdefghij2"))).toEqual([
      "00",
    ]);
    expect(diffBuckets(table("abcdefghijk"), table("abcdefghijk"))).toEqual([]);
    expect(
      diffBuckets("x".repeat(11) + "a" + "x".repeat(254 * 11), "x".repeat(11) + "b" + "x".repeat(254 * 11)),
    ).toEqual(["01"]);
  });
});

describe("mergeRemote", () => {
  const none = new Set<string>();

  it("takes remote items that are newer or unknown", () => {
    const local = [item(A, 5)];
    const merged = mergeRemote(
      local,
      { incoming: [item(A, 6, "remote"), item(B, 1)], deleted: [] },
      none,
    );

    expect(merged.upserts.map((i) => i.id)).toEqual([A, B]);
    expect(merged.deletedIds).toEqual([]);
  });

  it("keeps local items that are newer or equal", () => {
    const merged = mergeRemote(
      [item(A, 5), item(B, 5)],
      { incoming: [item(A, 4), item(B, 5)], deleted: [] },
      none,
    );

    expect(merged.upserts).toEqual([]);
  });

  it("never replaces or resurrects pending ids", () => {
    const merged = mergeRemote(
      [item(A, 1)],
      { incoming: [item(A, 9), item(B, 9)], deleted: [] },
      new Set([A, B]),
    );

    expect(merged.upserts).toEqual([]);
  });

  it("removes deleted items unless they are pending", () => {
    const merged = mergeRemote(
      [item(A, 1), item(B, 1), item(C, 1)],
      { incoming: [], deleted: [A, B] },
      new Set([B]),
    );

    expect(merged.deletedIds).toEqual([A]);
  });

  it("ignores deletes of unknown ids", () => {
    expect(
      mergeRemote([item(A, 1)], { incoming: [], deleted: [B] }, none)
        .deletedIds,
    ).toEqual([]);
  });
});

describe("pendingChanges", () => {
  it("derives changed items and removed ids from the acked objects", () => {
    const a = item(A, 1);
    const b = item(B, 1);
    const acked = new Map([
      [A, a],
      [B, b],
    ]);

    expect(pendingChanges([a, b], acked).ids.size).toBe(0);

    const edited = { ...a, content: "x" };
    const added = item(C, 1);
    const pending = pendingChanges([edited, added], acked);

    expect(pending.upserts).toEqual([edited, added]);
    expect(pending.removed).toEqual([B]);
    expect(pending.ids).toEqual(new Set([A, C, B]));
  });

  it("treats an equal copy as changed (identity ack)", () => {
    const a = item(A, 1);

    expect(
      pendingChanges([{ ...a }], new Map([[A, a]])).upserts,
    ).toHaveLength(1);
  });
});
