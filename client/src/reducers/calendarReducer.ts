import type { CalendarAction } from "@/types/calendar/Action";
import type { CalendarEvent, WithoutPrivateKeys } from "@/types/calendar/Event";

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
      return state.map((ev) => {
        const newEv = {
          ...ev,
          ...action.data,
          timestamp: Date.now(),
        };
        return ev.id === action.id
          ? (Object.fromEntries(
              Object.entries(newEv).filter(([key]) => !key.startsWith("_")),
            ) as WithoutPrivateKeys<CalendarEvent>)
          : ev;
      });
    case "delete":
      return state.filter((ev) => ev.id !== action.id);
    default:
      return state;
  }
}
