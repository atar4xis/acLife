import type { CalendarEvent } from "@/types/calendar/Event";
import { findFreeSlot } from "@/lib/calendar/freeSpace";

export const MOVE_MINUTE_STEPS = [5, 10, 15, 30];
export const MOVE_HOUR_STEPS = [1, 2, 3, 4, 5, 8];
export const MOVE_UNIT_STEPS = ["days", "weeks", "months", "years"] as const;

export function getMovedEvent(
  event: CalendarEvent,
  direction: "forward" | "backward",
  unit: "minutes" | "hours" | "days" | "weeks" | "months" | "years",
  amount: number,
): CalendarEvent {
  const delta = direction === "forward" ? amount : -amount;
  type MoveDelta = Partial<{
    minutes: number;
    hours: number;
    days: number;
    weeks: number;
    months: number;
    years: number;
  }>;
  const deltaObj = { [unit]: delta } as unknown as MoveDelta;
  return {
    ...event,
    start: event.start.plus(deltaObj),
    end: event.end.plus(deltaObj),
  } as CalendarEvent;
}

export function findFreeSlotForEvent(
  calendarEvents: CalendarEvent[],
  event: CalendarEvent,
  direction: "forward" | "backward",
  group?: CalendarEvent[],
) {
  return findFreeSlot(calendarEvents, event, direction, group);
}
