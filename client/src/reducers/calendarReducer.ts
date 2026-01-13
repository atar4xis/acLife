import type { CalendarAction } from "@/types/calendar/Action";
import type { CalendarEvent } from "@/types/calendar/Event";

export function calendarReducer(
  state: CalendarEvent[],
  action: CalendarAction,
): CalendarEvent[] {
  switch (action.type) {
    case "set":
      return action.events;
    case "add":
      return [...state, action.event];
    case "update":
      return state.map((ev) =>
        ev.id === action.id
          ? {
              ...ev,
              ...action.data,
              timestamp: Date.now(),
            }
          : ev,
      );
    case "delete":
      return state.filter((ev) => ev.id !== action.id);
    default:
      return state;
  }
}
