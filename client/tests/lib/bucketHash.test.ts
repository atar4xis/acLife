import { describe, expect, it } from "vitest";
import { computeBucketHash } from "../../src/lib/calendar/buckets.ts";

const a = { id: "00000000-0000-4000-8000-000000000001", ts: 1790000000001 };
const b = { id: "00000000-0000-4000-8000-000000000002", ts: 1790000000002 };

describe("computeBucketHash", () => {
  it("matches the server vectors", async () => {
    expect(await computeBucketHash([])).toBe(
      "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    );
    expect(await computeBucketHash([b, a])).toBe(
      "btzNbDUHdKllZ4LKVWjw/RXskjBTPxsdfiGY7i6Xh+A=",
    );
  });

  it("ignores order and id case", async () => {
    expect(await computeBucketHash([a, b])).toBe(
      await computeBucketHash([{ ...b, id: b.id.toUpperCase() }, a]),
    );
  });

  it("changes when a timestamp changes", async () => {
    expect(await computeBucketHash([a])).not.toBe(
      await computeBucketHash([{ ...a, ts: a.ts + 1 }]),
    );
  });
});
