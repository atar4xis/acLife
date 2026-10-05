import { DateTime } from "luxon";
import type { CalendarEvent, EventDragRef } from "@/types/calendar/Event";
import { eventKey } from "@/lib/calendar/event";

export type BarSlots = (CalendarEvent | undefined)[];

export const BAR_SLOTS = 3;

export const ALL_DAY_ROW_HEIGHT = 24;
export const ALL_DAY_MIN_ROWS = 1;
export const ALL_DAY_MAX_ROWS = 4;

// bar geometry in %
export const BARS_BOTTOM = 24; // of day cell
export const BARS_AREA = 26; // of day cell
export const BAR_HEIGHT = 26; // of area
export const BAR_GAP = 11; // of area
const NUMBER_GAP = 6; // of day cell, between day number and top bar

// day number padding that clears `rows` stacked bars
export const numberPadding = (rows: number) =>
  rows &&
  BARS_BOTTOM +
    (BARS_AREA * (rows * BAR_HEIGHT + (rows - 1) * BAR_GAP)) / 100 +
    NUMBER_GAP;

export const barKey = (e?: CalendarEvent) => e && eventKey(e);

const isMultiDay = (e: CalendarEvent) => !e.start.hasSame(e.end, "day");

// one row per event across all its days, so multi-day events stay connected
export function layoutBars(
  dateKeys: string[],
  eventMap: Map<string, CalendarEvent[]>,
  slotCount = BAR_SLOTS,
) {
  const spans = new Map<string, { day: number; event: CalendarEvent }[]>();
  dateKeys.forEach((date, day) => {
    for (const event of eventMap.get(date) ?? []) {
      const key = barKey(event)!;
      const span = spans.get(key) ?? [];
      span.push({ day, event });
      spans.set(key, span);
    }
  });

  const grid: BarSlots[] = dateKeys.map(() =>
    new Array(slotCount).fill(undefined),
  );
  const ordered = Array.from(spans).toSorted(
    ([ka, a], [kb, b]) =>
      Number(isMultiDay(b[0].event)) - Number(isMultiDay(a[0].event)) ||
      a[0].event.start.toMillis() - b[0].event.start.toMillis() ||
      Number(ka > kb) - Number(ka < kb),
  );

  for (const [, days] of ordered) {
    const fits = (row: number) => days.every(({ day }) => !grid[day][row]);
    let row = 0;
    while (row < slotCount && !fits(row)) row++;
    if (row === slotCount) continue;
    for (const { day, event } of days) grid[day][row] = event;
  }

  const result = new Map<string, { slots: BarSlots; overflow: number }>();
  dateKeys.forEach((date, day) => {
    const slots = grid[day];
    result.set(date, {
      slots,
      overflow:
        (eventMap.get(date)?.length ?? 0) - slots.filter(Boolean).length,
    });
  });

  return result;
}

type BarLayout = ReturnType<typeof layoutBars>;

export const barSpans = (layout: BarLayout, dateKeys: string[]) => {
  const spans = new Map<string, { day: number; span: number }>();
  dateKeys.forEach((date, day) => {
    for (const event of layout.get(date)?.slots ?? []) {
      const key = barKey(event);
      if (!key) continue;
      const found = spans.get(key);
      if (found) found.span++;
      else spans.set(key, { day, span: 1 });
    }
  });
  return spans;
};

export const barRow = (layout: BarLayout, key: string) => {
  for (const { slots } of layout.values()) {
    const row = slots.findIndex((e) => barKey(e) === key);
    if (row !== -1) return row;
  }
};

// true when both layouts render the same bars (event copies differ by identity)
export function sameBars(a: BarLayout, b: BarLayout) {
  if (a.size !== b.size) return false;

  for (const [date, x] of a) {
    const y = b.get(date);
    if (
      !y ||
      x.overflow !== y.overflow ||
      x.slots.some(
        (e, i) =>
          barKey(e) !== barKey(y.slots[i]) || e?.color !== y.slots[i]?.color,
      )
    )
      return false;
  }

  return true;
}

export const resizeAllDay = (
  type: NonNullable<EventDragRef>["type"],
  originalStart: DateTime,
  originalEnd: DateTime,
  dayDelta: number,
) =>
  type === "resize_start"
    ? {
        newStart: DateTime.min(
          originalStart.plus({ days: dayDelta }).startOf("day"),
          originalEnd.startOf("day"),
        ),
        newEnd: originalEnd,
      }
    : {
        newStart: originalStart,
        newEnd: DateTime.max(
          originalEnd.plus({ days: dayDelta }).endOf("day"),
          originalStart.endOf("day"),
        ),
      };
