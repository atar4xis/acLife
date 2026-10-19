import {
  canDeleteEvent,
  canEditEvent,
  persistable,
} from "@/lib/calendar/shared";
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
    case "append": {
      const known = new Set(state.map((ev) => ev.id));
      return [...state, ...action.events.filter((ev) => !known.has(ev.id))];
    }
    case "update":
      return state.map((ev) => {
        if (ev.id !== action.id || !canEditEvent(ev)) return ev;

        const newEv = {
          ...ev,
          ...action.data,
          timestamp: Date.now(),
        };
        return persistable({ ...newEv, _shared: ev._shared });
      });
    case "delete":
      return state.filter((ev) => ev.id !== action.id || !canDeleteEvent(ev));
    case "merge": {
      const incoming = new Map(
        action.events.map((ev) => [ev.id, { ...ev, _remote: true }]),
      );
      const known = new Set(state.map((ev) => ev.id));
      return [
        ...state
          .filter((ev) => !action.deletedIds.includes(ev.id))
          .map((ev) => {
            const next = incoming.get(ev.id);
            return next && ev.timestamp < next.timestamp ? next : ev;
          }),
        ...[...incoming.values()].filter((ev) => !known.has(ev.id)),
      ];
    }
    default:
      return state;
  }
}
