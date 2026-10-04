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
    case "merge": {
      const incoming = new Map(action.events.map((ev) => [ev.id, ev]));
      const known = new Set(state.map((ev) => ev.id));
      return [
        ...state
          .filter((ev) => !action.deletedIds.includes(ev.id))
          .map((ev) => {
            const next = incoming.get(ev.id);
            return next && ev.timestamp < next.timestamp ? next : ev;
          }),
        ...action.events.filter((ev) => !known.has(ev.id)),
      ];
    }
    default:
      return state;
  }
}
