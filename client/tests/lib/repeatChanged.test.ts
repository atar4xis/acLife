import { describe, expect, it } from "vitest";
import { repeatChanged } from "@/lib/calendar/repeatOptions";

describe("repeatChanged", () => {
  it("ignores the implicit monthly mode of legacy repeats", () => {
    expect(
      repeatChanged(
        { interval: 1, unit: "month" },
        { interval: 1, unit: "month", monthly: "date" },
      ),
    ).toBe(false);
  });

  it("detects a different interval", () => {
    expect(
      repeatChanged({ interval: 1, unit: "week" }, { interval: 2, unit: "week" }),
    ).toBe(true);
  });

  it("detects a different end", () => {
    const daily = { interval: 1, unit: "day" as const };
    expect(repeatChanged({ ...daily, count: 3 }, { ...daily, count: 5 })).toBe(true);
    expect(repeatChanged({ ...daily, until: 1 }, { ...daily, until: 2 })).toBe(true);
  });

  it("detects a repeat being added or removed", () => {
    expect(repeatChanged(undefined, { interval: 1, unit: "day" })).toBe(true);
    expect(repeatChanged({ interval: 1, unit: "day" }, undefined)).toBe(true);
    expect(repeatChanged(undefined, undefined)).toBe(false);
  });
});
