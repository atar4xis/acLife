import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { eventKey, getEventMap } from "../../src/lib/calendar/event.ts";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";

const at = (iso: string, zone = "UTC") => DateTime.fromISO(iso, { zone });

const event = (
  id: string,
  start: string,
  end: string,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id,
  title: id,
  timestamp: 0,
  start: at(start),
  end: at(end),
  ...extra,
});

const days = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) => at(from).plus({ days: i }));

const ids = (map: Map<string, CalendarEvent[]>, date: string) =>
  (map.get(date) ?? []).map((e) => e._instanceId ?? e.id);

const WINDOW = () => days("2026-03-18", 3);

describe("getEventMap window", () => {
  it("places nothing for events clear of the visible days", () => {
    const map = getEventMap(
      [
        event("before", "2025-11-02T09:00", "2025-11-02T10:00"),
        event("inside", "2026-03-19T09:00", "2026-03-19T10:00"),
        event("after", "2026-09-02T09:00", "2026-09-02T10:00"),
      ],
      WINDOW(),
      [],
      [],
    );

    expect([...map.keys()]).toEqual(["2026-03-19"]);
    expect(ids(map, "2026-03-19")).toEqual(["inside"]);
  });

  it("keeps multi-day events that start before or end after the window", () => {
    const map = getEventMap(
      [
        event("from-before", "2026-02-20T09:00", "2026-03-18T10:00"),
        event("to-after", "2026-03-20T09:00", "2026-04-25T10:00"),
        event("spans-all", "2026-01-01T09:00", "2026-06-01T10:00"),
      ],
      WINDOW(),
      [],
      [],
    );

    expect(ids(map, "2026-03-18")).toEqual(["from-before", "spans-all"]);
    expect(ids(map, "2026-03-20")).toEqual(["to-after", "spans-all"]);
  });

  it("keeps an event whose zone puts its day inside the window", () => {
    // 01:00 on the 20th in UTC+14 is still the 19th in UTC
    const map = getEventMap(
      [
        {
          ...event("kiritimati", "2026-03-20T01:00", "2026-03-20T02:00"),
          start: at("2026-03-20T01:00", "Pacific/Kiritimati"),
          end: at("2026-03-20T02:00", "Pacific/Kiritimati"),
        },
      ],
      days("2026-03-20", 1),
      [],
      [],
    );

    expect(ids(map, "2026-03-20")).toEqual(["kiritimati"]);
  });

  it("expands repeating events that started long before the window", () => {
    const map = getEventMap(
      [
        event("weekly", "2025-01-01T09:00", "2025-01-01T10:00", {
          repeat: { interval: 1, unit: "week" },
        }),
        event("daily-ended", "2025-01-01T09:00", "2025-01-01T10:00", {
          repeat: {
            interval: 1,
            unit: "day",
            until: at("2025-06-01").toMillis(),
          },
        }),
      ],
      WINDOW(),
      [],
      [],
    );

    // 2026-03-18 is a Wednesday, like 2025-01-01
    expect(ids(map, "2026-03-18")).toEqual(["weekly_2026-03-18"]);
    expect([...map.keys()]).toEqual(["2026-03-18"]);
  });

  it("keeps the input order within a day", () => {
    const map = getEventMap(
      [
        event("first", "2026-03-18T15:00", "2026-03-18T16:00"),
        event("far", "2025-03-18T09:00", "2025-03-18T10:00"),
        event("second", "2026-03-18T09:00", "2026-03-18T10:00"),
      ],
      WINDOW(),
      [],
      [],
    );

    expect(ids(map, "2026-03-18")).toEqual(["first", "second"]);
  });
});

describe("getEventMap keys", () => {
  const dupes = (map: Map<string, CalendarEvent[]>) =>
    [...map.entries()].flatMap(([date, list]) => {
      const keys = list.map(eventKey);
      return keys
        .filter((k, i) => keys.indexOf(k) !== i)
        .map((k) => `${date} ${k}`);
    });

  const series = [
    event("daily3", "2026-03-10T22:00", "2026-03-13T02:00", {
      repeat: { interval: 1, unit: "day" },
    }),
    event("weekly", "2026-02-04T09:00", "2026-02-04T10:00", {
      repeat: { interval: 1, unit: "week" },
    }),
    event("monthEnd", "2026-01-31T09:00", "2026-01-31T10:00", {
      repeat: { interval: 1, unit: "month" },
    }),
    event("yearly", "2024-03-19T09:00", "2024-03-19T10:00", {
      repeat: { interval: 1, unit: "year" },
    }),
    event("overnight", "2026-03-18T23:00", "2026-03-19T01:00"),
    event("plain", "2026-03-18T09:00", "2026-03-18T10:00"),
  ];

  it("never repeats a key within one day", () => {
    expect(dupes(getEventMap(series, days("2026-03-01", 49), [], []))).toEqual(
      [],
    );
  });

  it("holds across a DST change in a named zone", () => {
    const ny = (id: string, start: string, end: string, extra = {}) => ({
      ...event(id, start, end, extra),
      start: at(start, "America/New_York"),
      end: at(end, "America/New_York"),
    });
    const events = [
      ny("dst", "2026-03-07T02:30", "2026-03-09T03:30", {
        repeat: { interval: 1, unit: "day" },
      }),
    ];

    expect(dupes(getEventMap(events, days("2026-03-01", 21), [], []))).toEqual(
      [],
    );
  });

  it("holds when a dragged instance or parent is swapped for its preview", () => {
    const base = getEventMap(series, days("2026-03-12", 7), [], []);
    const instance = base
      .get("2026-03-18")!
      .find((e) => e._parent === "weekly");
    const parentCopy = { ...series[0] };

    for (const dragged of [instance!, parentCopy]) {
      const map = getEventMap(
        series,
        days("2026-03-12", 7),
        [eventKey(dragged)],
        [
          {
            ...dragged,
            repeat: undefined,
            start: dragged.start.plus({ days: 1 }),
            end: dragged.end.plus({ days: 1 }),
          },
        ],
      );
      expect(dupes(map)).toEqual([]);
    }
  });
});
