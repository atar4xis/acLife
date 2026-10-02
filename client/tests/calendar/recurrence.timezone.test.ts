import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { getEventMap } from "../../src/lib/calendar/event.ts";
import {
  moveToFirstOccurrence,
  skipSingleOccurrence,
} from "../../src/lib/calendar/recurrence.ts";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";

const ZONE = "Asia/Tokyo";

// 08:00 in Tokyo is 23:00 UTC the previous day, so the UTC weekday differs from the local one
const at = (iso: string) => DateTime.fromISO(iso, { zone: ZONE });

const buildParent = (except: number[]): CalendarEvent => ({
  id: "daily",
  title: "Daily",
  start: at("2026-03-18T08:00"),
  end: at("2026-03-18T09:00"),
  timestamp: 0,
  repeat: { interval: 1, unit: "day", except },
});

describe("repeat except weekdays in a non-UTC zone", () => {
  it("excludes local weekdays when expanding a daily repeat", () => {
    const week = Array.from({ length: 7 }, (_, i) =>
      at("2026-03-16T00:00").plus({ days: i }),
    );
    // Mon, Tue, Sat, Sun excluded; the 18th (Wed) is the series start
    const map = getEventMap([buildParent([1, 2, 6, 7])], week, [], []);
    const days = [...map.entries()]
      .filter(([, evs]) => evs.length > 0)
      .map(([key]) => key);

    expect(days.sort()).toEqual(["2026-03-18", "2026-03-19", "2026-03-20"]);
  });

  it("skips excluded local weekdays when moving the parent past a deleted occurrence", () => {
    const parent = buildParent([4]);
    const dispatch = vi.fn();

    const moved = skipSingleOccurrence(parent, [parent], dispatch, vi.fn());

    expect(moved?.start.toISODate()).toBe("2026-03-20");
  });
});

describe("moveToFirstOccurrence", () => {
  const day = (except: number[]) => ({ interval: 1, unit: "day" as const, except });
  const start = at("2026-03-16T08:00");
  const end = at("2026-03-16T09:00");

  it("returns null when the start day is not excluded", () => {
    expect(moveToFirstOccurrence(start, end, day([2]))).toBeNull();
    expect(moveToFirstOccurrence(start, end, undefined)).toBeNull();
  });

  it("moves to the next included local day, keeping the wall time", () => {
    const moved = moveToFirstOccurrence(start, end, day([1, 2, 6, 7]));
    expect(moved?.start.toISO()).toBe(at("2026-03-18T08:00").toISO());
    expect(moved?.end.toISO()).toBe(at("2026-03-18T09:00").toISO());
  });

  it("wraps past the weekend", () => {
    const friday = at("2026-03-20T08:00");
    const moved = moveToFirstOccurrence(friday, friday, day([5, 6, 7]));
    expect(moved?.start.toISODate()).toBe("2026-03-23");
  });
});
