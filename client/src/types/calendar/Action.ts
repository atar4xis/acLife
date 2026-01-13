import type { CalendarEvent } from "./Event";

export type CalendarAction =
  | { type: "set"; events: CalendarEvent[] }
  | { type: "update"; id: string; data: Partial<CalendarEvent> }
  | { type: "delete"; id: string }
  | { type: "add"; event: CalendarEvent };
