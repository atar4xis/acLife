import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  fromPickerDate,
  getDateRangeString,
  getWeekDays,
  toPickerDate,
} from "../../src/lib/calendar/date.ts";

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
    const days = getWeekDays(wednesday, 1);
    expect(days[0].date.weekday).toBe(1);
    expect(days[0].date.toISODate()).toBe("2026-03-16");
  });

  it("starts the week on Sunday when requested", () => {
    const days = getWeekDays(wednesday, 7);
    expect(days[0].date.weekday).toBe(7);
    expect(days[0].date.toISODate()).toBe("2026-03-15");
    expect(days[6].date.toISODate()).toBe("2026-03-21");
  });

  it("starts the week on any weekday, such as Saturday", () => {
    const days = getWeekDays(wednesday, 6);
    expect(days[0].date.weekday).toBe(6);
    expect(days[0].date.toISODate()).toBe("2026-03-14");
    expect(days[6].date.toISODate()).toBe("2026-03-20");
  });

  it("keeps a Sunday date as the start of its own Sunday-starting week", () => {
    const sunday = DateTime.fromISO("2026-03-15T00:00:00");
    const days = getWeekDays(sunday, 7);
    expect(days[0].date.toISODate()).toBe("2026-03-15");
  });

  it("keeps a Monday date as the start of its own Monday-starting week", () => {
    const monday = DateTime.fromISO("2026-03-16T00:00:00");
    const days = getWeekDays(monday, 1);
    expect(days[0].date.toISODate()).toBe("2026-03-16");
  });

  it("truncates the time of day off the start date", () => {
    const days = getWeekDays(wednesday, 1);
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
    expect(getDateRangeString("week", wednesday, 1)).toBe("March 2026");
  });

  it("formats a Sunday-starting week fully inside one month", () => {
    expect(getDateRangeString("week", wednesday, 7)).toBe("March 2026");
  });

  it("spans two months when the week start straddles a month boundary", () => {
    // 2026-04-01 is a Wednesday; a Sunday-start week begins 2026-03-29
    const straddling = DateTime.fromISO("2026-04-01T00:00:00");
    expect(getDateRangeString("week", straddling, 7)).toBe(
      "Mar 2026 - Apr 2026",
    );
  });

  it("defaults to Monday start when weekStartsOn is omitted", () => {
    const straddling = DateTime.fromISO("2026-04-01T00:00:00");
    expect(getDateRangeString("week", straddling)).toBe(
      getDateRangeString("week", straddling, 1),
    );
  });
});

describe("picker dates", () => {
  it("turns a zoned date into local midnight on the same calendar day", () => {
    // 01:00 on the 15th in Tokyo is still the 14th in UTC, which the tests run in
    const tokyo = DateTime.fromISO("2026-03-15T01:00:00", {
      zone: "Asia/Tokyo",
    });

    const picker = toPickerDate(tokyo);

    expect([
      picker.getFullYear(),
      picker.getMonth(),
      picker.getDate(),
      picker.getHours(),
    ]).toEqual([2026, 2, 15, 0]);
  });

  it("turns a picked day into midnight of that day in the default zone", () => {
    const picked = fromPickerDate(new Date(2026, 2, 20));

    expect(picked.toISO()).toBe(
      DateTime.fromISO("2026-03-20T00:00:00").toISO(),
    );
  });

  it("round-trips a calendar day", () => {
    const date = DateTime.fromISO("2026-12-31T23:59:00");

    expect(fromPickerDate(toPickerDate(date)).toISODate()).toBe("2026-12-31");
  });
});
