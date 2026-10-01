import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { layoutBars } from "../../src/lib/calendar/eventBars.ts";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";

const day = (d: number) => `2026-03-${String(d).padStart(2, "0")}`;

const event = (
  id: string,
  d: number,
  hour: number,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id,
  title: id,
  start: DateTime.fromISO(`${day(d)}T${String(hour).padStart(2, "0")}:00`),
  end: DateTime.fromISO(`${day(d)}T${String(hour + 1).padStart(2, "0")}:00`),
  timestamp: 0,
  ...overrides,
});

const ids = (slots: (CalendarEvent | undefined)[]) => slots.map((e) => e?.id);

const layout = (map: Record<number, CalendarEvent[]>, days: number[]) =>
  layoutBars(
    days.map(day),
    new Map(Object.entries(map).map(([d, events]) => [day(Number(d)), events])),
  );

describe("layoutBars", () => {
  it("returns empty slots for days without events", () => {
    const result = layout({}, [1]);

    expect(ids(result.get(day(1))!.slots)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(result.get(day(1))!.overflow).toBe(0);
  });

  it("orders a day's events by start time", () => {
    const result = layout(
      { 1: [event("late", 1, 15), event("early", 1, 8)] },
      [1],
    );

    expect(ids(result.get(day(1))!.slots)).toEqual([
      "early",
      "late",
      undefined,
    ]);
  });

  it("keeps a multi-day event in the same row on every day", () => {
    const long = event("long", 1, 12);
    const result = layout(
      {
        1: [event("a", 1, 8), long],
        2: [event("b", 2, 8), { ...long, _continued: true }],
        3: [{ ...long, _continued: true }],
      },
      [1, 2, 3],
    );

    expect(ids(result.get(day(1))!.slots)).toEqual(["a", "long", undefined]);
    // "b" starts earlier than the continued event but must not take its row
    expect(ids(result.get(day(2))!.slots)).toEqual(["b", "long", undefined]);
    expect(ids(result.get(day(3))!.slots)).toEqual([
      undefined,
      "long",
      undefined,
    ]);
  });

  it("reuses a row once the event holding it has ended", () => {
    const result = layout(
      { 1: [event("a", 1, 8)], 2: [event("b", 2, 8)] },
      [1, 2],
    );

    expect(ids(result.get(day(2))!.slots)).toEqual(["b", undefined, undefined]);
  });

  it("treats recurring instances with different instance ids as different events", () => {
    const result = layout(
      {
        1: [event("series", 1, 8, { _instanceId: "series_1" })],
        2: [event("series", 2, 8, { _instanceId: "series_2" })],
      },
      [1, 2],
    );

    expect(result.get(day(1))!.slots[0]?._instanceId).toBe("series_1");
    expect(result.get(day(2))!.slots[0]?._instanceId).toBe("series_2");
  });

  it("keeps overlapping instances of one series in their own rows", () => {
    const first = event("series", 1, 8, { _instanceId: "series_a" });
    const second = event("series", 1, 9, { _instanceId: "series_b" });
    const result = layout(
      {
        1: [first, second],
        2: [
          { ...first, _continued: true },
          { ...second, _continued: true },
        ],
      },
      [1, 2],
    );

    expect(result.get(day(2))!.slots.map((e) => e?._instanceId)).toEqual([
      "series_a",
      "series_b",
      undefined,
    ]);
  });

  it("caps rows at 3 and counts the rest as overflow", () => {
    const events = [8, 9, 10, 11, 12, 13].map((h) => event(`e${h}`, 1, h));
    const result = layout({ 1: events }, [1]);

    expect(ids(result.get(day(1))!.slots)).toEqual(["e8", "e9", "e10"]);
    expect(result.get(day(1))!.overflow).toBe(3);
  });

  it("reports an overflow of 1 for 4 events", () => {
    const events = [8, 9, 10, 11].map((h) => event(`e${h}`, 1, h));

    expect(layout({ 1: events }, [1]).get(day(1))!.overflow).toBe(1);
  });

  it("counts continued events in the overflow when no row is free", () => {
    const long = event("long", 1, 7);
    const result = layout(
      {
        1: [long, event("a", 1, 8), event("b", 1, 9)],
        2: [
          { ...long, _continued: true },
          event("c", 2, 8),
          event("d", 2, 9),
          event("e", 2, 10),
        ],
      },
      [1, 2],
    );

    expect(ids(result.get(day(2))!.slots)).toEqual(["long", "c", "d"]);
    expect(result.get(day(2))!.overflow).toBe(1);
  });
});
