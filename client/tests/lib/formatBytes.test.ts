import { describe, expect, it } from "vitest";
import { formatBytes } from "../../src/lib/utils.ts";

describe("formatBytes", () => {
  it("counts bytes below 1 KiB", () => {
    expect(formatBytes(0, "en")).toBe("0 byte");
    expect(formatBytes(1023, "en")).toBe("1,023 byte");
  });

  it("scales by 1024", () => {
    expect(formatBytes(1024, "en")).toBe("1 kB");
    expect(formatBytes(1536, "en")).toBe("1.5 kB");
    expect(formatBytes(500 * 1024 ** 2, "en")).toBe("500 MB");
    expect(formatBytes(5 * 1024 ** 3, "en")).toBe("5 GB");
  });

  it("moves up a unit when rounding reaches 1024", () => {
    expect(formatBytes(1048575, "en")).toBe("1 MB");
    expect(formatBytes(1023.9 * 1024, "en")).toBe("1,023.9 kB");
  });

  it("stops at terabytes", () => {
    expect(formatBytes(3 * 1024 ** 4, "en")).toBe("3 TB");
    expect(formatBytes(5000 * 1024 ** 4, "en")).toBe("5,000 TB");
  });

  it("follows the language", () => {
    expect(formatBytes(1536, "de")).toBe("1,5 kB");
  });
});
