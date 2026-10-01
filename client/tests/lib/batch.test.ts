import { describe, expect, it } from "vitest";
import { flatMapInBatches } from "../../src/lib/batch.ts";

describe("flatMapInBatches", () => {
  it("flat-maps every item in order, skipping empty results", async () => {
    const result = await flatMapInBatches(
      [1, 2, 3, 4, 5],
      (n) => (n % 2 ? [n, n * 10] : []),
      2,
    );
    expect(result).toEqual([1, 10, 3, 30, 5, 50]);
  });

  it("returns an empty list for no items", async () => {
    expect(await flatMapInBatches([], (n) => [n], 3)).toEqual([]);
  });
});
