import { describe, expect, it } from "vitest";
import { base64ByteLength } from "@/lib/utils";

describe("base64ByteLength", () => {
  it.each([0, 1, 2, 3, 4, 10, 255])("matches decoded length for %i bytes", (n) => {
    const b64 = btoa("x".repeat(n));
    expect(base64ByteLength(b64)).toBe(n);
  });
});
