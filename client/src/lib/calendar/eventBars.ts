import type { CalendarEvent } from "@/types/calendar/Event";

export type BarSlots = (CalendarEvent | undefined)[];

export const BAR_SLOTS = 3;
export const barKey = (e?: CalendarEvent) => e && (e._instanceId ?? e.id);

// assigns each event a fixed row so multi-day events line up across days
export function layoutBars(
  dateKeys: string[],
  eventMap: Map<string, CalendarEvent[]>,
) {
  const result = new Map<string, { slots: BarSlots; overflow: number }>();
  let prev: BarSlots = [];

  for (const date of dateKeys) {
    const slots: BarSlots = new Array(BAR_SLOTS).fill(undefined);
    const pending: CalendarEvent[] = [];
    const events = (eventMap.get(date) ?? []).toSorted(
      (a, b) => a.start.toMillis() - b.start.toMillis(),
    );

    for (const e of events) {
      const i = prev.findIndex((p) => barKey(p) === barKey(e));
      if (e._continued && i !== -1) slots[i] = e;
      else pending.push(e);
    }
    for (const e of pending) {
      const i = slots.indexOf(undefined);
      if (i !== -1) slots[i] = e;
    }

    result.set(date, {
      slots,
      overflow: events.length - slots.filter(Boolean).length,
    });
    prev = slots;
  }

  return result;
}

type BarLayout = ReturnType<typeof layoutBars>;

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
