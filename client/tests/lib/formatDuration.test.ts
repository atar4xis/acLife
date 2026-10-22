import { describe, expect, it } from "vitest";
import { formatDuration } from "../../src/lib/utils.ts";

describe("formatDuration", () => {
  it("uses the largest unit that divides the seconds evenly", () => {
    expect(formatDuration(86400, "en")).toBe("1 day");
    expect(formatDuration(7 * 86400, "en")).toBe("7 days");
    expect(formatDuration(3600, "en")).toBe("1 hour");
    expect(formatDuration(2700, "en")).toBe("45 minutes");
    expect(formatDuration(90, "en")).toBe("90 seconds");
  });

  it("follows the language", () => {
    expect(formatDuration(300, "fr")).toBe("5 minutes");
    expect(formatDuration(86400, "es")).toBe("1 día");
  });
});
