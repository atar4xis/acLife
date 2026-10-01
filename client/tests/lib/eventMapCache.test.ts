import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { getEventMap } from "@/lib/calendar/event";
import type { CalendarEvent } from "@/types/calendar/Event";

const day = DateTime.fromISO("2025-03-10", { zone: "UTC" });
const days = (n: number) =>
  Array.from({ length: n }, (_, i) => day.plus({ days: i }));

const ev = (id: string, hour: number, extra = {}) =>
  ({
    id,
    title: id,
    color: "#fff",
    start: day.plus({ hours: hour }),
    end: day.plus({ hours: hour + 1 }),
    timestamp: 0,
    isTask: false,
    ...extra,
  }) as CalendarEvent;

describe("getEventMap caching", () => {
  it("keeps identity of unchanged events and day arrays when an event is added", () => {
    const a = ev("a", 1);
    const b = ev("b", 3, { repeat: { unit: "day", interval: 1 } });
    const window = days(3);

    const before = getEventMap([a, b], window, [], []);
    const after = getEventMap([a, b, ev("c", 5)], window, [], []);

    const key = day.toISODate()!;
    expect(after.get(key)).toHaveLength(3);
    expect(after.get(key)![0]).toBe(before.get(key)![0]);
    expect(after.get(key)![1]).toBe(before.get(key)![1]);

    const other = day.plus({ days: 1 }).toISODate()!;
    expect(after.get(other)).toBe(before.get(other));
  });

  it("returns the same results for different windows used alternately", () => {
    const events = [
      ev("a", 1),
      ev("b", 3, { repeat: { unit: "day", interval: 1 } }),
    ];
    const wide = getEventMap(events, days(7), [], []);
    getEventMap(events, days(2), [], []);

    expect(
      getEventMap(events, days(7), [], []).get(
        day.plus({ days: 6 }).toISODate()!,
      ),
    ).toEqual(wide.get(day.plus({ days: 6 }).toISODate()!));
    expect(wide.get(day.plus({ days: 6 }).toISODate()!)).toHaveLength(1);
  });
});
