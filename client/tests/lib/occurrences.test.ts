import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { occurrences } from "@/lib/calendar/occurrences";
import { nearbyOccurrences, occurrencesBefore } from "@/lib/calendar/recurrence";
import type { CalendarEvent, RepeatInterval } from "@/types/calendar/Event";

const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });
const take = (anchor: string, repeat: RepeatInterval, n: number) => {
  const found: string[] = [];
  for (const d of occurrences(at(anchor), repeat)) {
    if (found.length >= n) break;
    found.push(d.toISODate()!);
  }
  return found;
};

describe("occurrences", () => {
  it("skips months without the date", () => {
    expect(
      take("2026-01-30T09:00", { interval: 1, unit: "month", monthly: "date" }, 3),
    ).toEqual(["2026-01-30", "2026-03-30", "2026-04-30"]);
  });

  it("repeats on the nth weekday", () => {
    expect(
      take("2026-03-09T09:00", { interval: 1, unit: "month", monthly: "nth" }, 3),
    ).toEqual(["2026-03-09", "2026-04-13", "2026-05-11"]);
  });

  it("repeats on the last weekday", () => {
    expect(
      take("2026-03-30T09:00", { interval: 1, unit: "month", monthly: "last" }, 3),
    ).toEqual(["2026-03-30", "2026-04-27", "2026-05-25"]);
  });

  it("repeats on specific month days", () => {
    expect(
      take(
        "2026-01-05T09:00",
        { interval: 1, unit: "month", monthly: "days", days: [5, 31] },
        4,
      ),
    ).toEqual(["2026-01-05", "2026-01-31", "2026-02-05", "2026-03-05"]);
  });

  it("repeats on specific weekdays every other week", () => {
    expect(
      take("2026-03-09T09:00", { interval: 2, unit: "week", days: [1, 3] }, 4),
    ).toEqual(["2026-03-09", "2026-03-11", "2026-03-23", "2026-03-25"]);
  });

  it("repeats on specific year days", () => {
    expect(
      take(
        "2026-03-01T09:00",
        { interval: 1, unit: "year", yearDays: ["03-01", "12-25"] },
        3,
      ),
    ).toEqual(["2026-03-01", "2026-12-25", "2027-03-01"]);
  });

  it("stops after count, not counting excluded days", () => {
    expect(
      take("2026-03-13T09:00", { interval: 1, unit: "day", except: [6, 7], count: 3 }, 10),
    ).toEqual(["2026-03-13", "2026-03-16", "2026-03-17"]);
  });

  it("stops at until, inclusive of that day", () => {
    const until = at("2026-03-12T00:00").endOf("day").toMillis();
    expect(take("2026-03-10T09:00", { interval: 1, unit: "day", until }, 10)).toEqual([
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
    ]);
  });

  it("jumps ahead without changing the occurrences", () => {
    const repeat: RepeatInterval = { interval: 1, unit: "month", monthly: "date" };
    const [first] = occurrences(at("2026-01-31T09:00"), repeat, at("2026-06-01T00:00"));
    expect(first.toISODate()).toBe("2026-07-31");
  });
});

describe("occurrencesBefore", () => {
  it("counts occurrences before a date, ignoring skipped ones", () => {
    const repeat: RepeatInterval = { interval: 1, unit: "day", skip: ["2026-03-11"] };
    expect(occurrencesBefore(at("2026-03-10T09:00"), repeat, at("2026-03-13T09:00"))).toBe(2);
  });

  it("stops counting at count", () => {
    const repeat: RepeatInterval = { interval: 1, unit: "day", count: 2 };
    expect(occurrencesBefore(at("2026-03-10T09:00"), repeat, at("2026-03-20T09:00"))).toBe(2);
  });
});

describe("nearbyOccurrences", () => {
  const event = (repeat: RepeatInterval): CalendarEvent => ({
    id: "e",
    title: "E",
    start: at("2026-01-05T09:00"),
    end: at("2026-01-05T10:00"),
    timestamp: 0,
    repeat,
  });
  const dates = (repeat: RepeatInterval, now: string) =>
    nearbyOccurrences(event(repeat), at(now), 2).map((e) => e.start.toISODate());

  it("finds occurrences on both sides of now for weekday repeats", () => {
    expect(dates({ interval: 1, unit: "week", days: [1, 3] }, "2026-03-11T12:00")).toEqual([
      "2026-03-09",
      "2026-03-11",
      "2026-03-16",
      "2026-03-18",
    ]);
  });

  it("widens the lookback for sparse repeats", () => {
    expect(dates({ interval: 1, unit: "year", yearDays: ["03-01"] }, "2028-06-01T00:00")).toEqual([
      "2027-03-01",
      "2028-03-01",
      "2029-03-01",
      "2030-03-01",
    ]);
  });

  it("returns the series start for the first occurrence", () => {
    const [first] = nearbyOccurrences(event({ interval: 1, unit: "day" }), at("2026-01-01T00:00"), 2);
    expect(first.id).toBe("e");
  });
});
