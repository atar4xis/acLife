import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { getEventMap } from "../../src/lib/calendar/event.ts";
import {
  detachSingleOccurrence,
  skipSingleOccurrence,
} from "../../src/lib/calendar/recurrence.ts";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";

const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

const series = (
  start: string,
  repeat: CalendarEvent["repeat"],
): CalendarEvent => ({
  id: "series",
  title: "Series",
  start: at(start),
  end: at(start).plus({ hours: 1 }),
  timestamp: 0,
  repeat,
});

const daysIn = (event: CalendarEvent, from: string, count: number) => {
  const dates = Array.from({ length: count }, (_, i) =>
    at(from).plus({ days: i }),
  );
  const map = getEventMap([event], dates, [], []);
  return [...map.entries()]
    .filter(([, evs]) => evs.length > 0)
    .map(([key]) => key)
    .sort();
};

describe("month-end repeats", () => {
  const monthly = series("2026-01-31T09:00", { interval: 1, unit: "month" });

  it("lands on the clamped month end regardless of the visible window", () => {
    expect(daysIn(monthly, "2026-03-25", 10)).toEqual(["2026-03-31"]);
    expect(daysIn(monthly, "2026-02-23", 10)).toEqual(["2026-02-28"]);
    expect(daysIn(monthly, "2026-04-25", 10)).toEqual(["2026-04-30"]);
    expect(daysIn(monthly, "2026-05-25", 10)).toEqual(["2026-05-31"]);
  });
});

describe("repeat until", () => {
  const until = at("2026-03-12T00:00").toMillis();
  const daily = series("2026-03-10T09:00", { interval: 1, unit: "day", until });

  it("deletes the parent when skipping its last occurrence", () => {
    const dispatch = vi.fn();
    const updateChange = vi.fn();
    const ended = series("2026-03-11T09:00", daily.repeat);

    const result = skipSingleOccurrence(ended, [ended], dispatch, updateChange);

    expect(result).toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith({ type: "delete", id: "series" });
    expect(updateChange).toHaveBeenCalledWith({
      id: "series",
      type: "deleted",
    });
  });

  it("moves the parent while occurrences remain before until", () => {
    const dispatch = vi.fn();

    const result = skipSingleOccurrence(daily, [daily], dispatch, vi.fn());

    expect(result?.start.toISODate()).toBe("2026-03-11");
  });

  it("deletes the parent and keeps the detached copy when moving its last occurrence", () => {
    const dispatch = vi.fn();
    const ended = series("2026-03-11T09:00", daily.repeat);
    const moved = { ...ended, start: ended.start.plus({ hours: 2 }) };

    const result = detachSingleOccurrence(
      moved,
      ended.start,
      [ended],
      dispatch,
      vi.fn(),
    );

    expect(result).toBeUndefined();
    expect(dispatch).toHaveBeenCalledWith({ type: "delete", id: "series" });
    const added = dispatch.mock.calls.find(([a]) => a.type === "add")![0].event;
    expect(added.repeat).toBeUndefined();
  });
});
