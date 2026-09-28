import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { getDateRangeString, getWeekDays } from "../../src/lib/calendar/date.ts";

describe("getWeekDays", () => {
  // 2026-03-18 is a Wednesday
  const wednesday = DateTime.fromISO("2026-03-18T10:30:00");

  it("defaults to a Monday-starting week", () => {
    const days = getWeekDays(wednesday);
    expect(days).toHaveLength(7);
    expect(days[0].date.weekday).toBe(1);
    expect(days[0].date.toISODate()).toBe("2026-03-16");
    expect(days[6].date.toISODate()).toBe("2026-03-22");
  });

  it("starts the week on Monday when explicitly requested", () => {
    const days = getWeekDays(wednesday, "mon");
    expect(days[0].date.weekday).toBe(1);
    expect(days[0].date.toISODate()).toBe("2026-03-16");
  });

  it("starts the week on Sunday when requested", () => {
    const days = getWeekDays(wednesday, "sun");
    expect(days[0].date.weekday).toBe(7);
    expect(days[0].date.toISODate()).toBe("2026-03-15");
    expect(days[6].date.toISODate()).toBe("2026-03-21");
  });

  it("keeps a Sunday date as the start of its own Sunday-starting week", () => {
    const sunday = DateTime.fromISO("2026-03-15T00:00:00");
    const days = getWeekDays(sunday, "sun");
    expect(days[0].date.toISODate()).toBe("2026-03-15");
  });

  it("keeps a Monday date as the start of its own Monday-starting week", () => {
    const monday = DateTime.fromISO("2026-03-16T00:00:00");
    const days = getWeekDays(monday, "mon");
    expect(days[0].date.toISODate()).toBe("2026-03-16");
  });

  it("truncates the time of day off the start date", () => {
    const days = getWeekDays(wednesday, "mon");
    expect(days[0].date.hour).toBe(0);
    expect(days[0].date.minute).toBe(0);
  });
});

describe("getDateRangeString", () => {
  const wednesday = DateTime.fromISO("2026-03-18T10:30:00");

  it("formats month mode regardless of week start", () => {
    expect(getDateRangeString("month", wednesday)).toBe("March 2026");
  });

  it("formats day mode using the day's own month", () => {
    expect(getDateRangeString("day", wednesday)).toBe("March 2026");
  });

  it("formats a Monday-starting week fully inside one month", () => {
    expect(getDateRangeString("week", wednesday, "mon")).toBe("March 2026");
  });

  it("formats a Sunday-starting week fully inside one month", () => {
    expect(getDateRangeString("week", wednesday, "sun")).toBe("March 2026");
  });

  it("spans two months when the week start straddles a month boundary", () => {
    // 2026-04-01 is a Wednesday; a Sunday-start week begins 2026-03-29
    const straddling = DateTime.fromISO("2026-04-01T00:00:00");
    expect(getDateRangeString("week", straddling, "sun")).toBe(
      "Mar 2026 - Apr 2026",
    );
  });

  it("defaults to Monday start when weekStartsOn is omitted", () => {
    const straddling = DateTime.fromISO("2026-04-01T00:00:00");
    expect(getDateRangeString("week", straddling)).toBe(
      getDateRangeString("week", straddling, "mon"),
    );
  });
});
