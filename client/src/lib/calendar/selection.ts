import type { CalendarEvent } from "@/types/calendar/Event";
import { eventKey } from "./event";

export function createSelectionStore() {
  let selected = new Map<string, CalendarEvent>();
  const listeners = new Set<() => void>();

  const replace = (next: Map<string, CalendarEvent>) => {
    selected = next;
    listeners.forEach((l) => l());
  };

  return {
    get: () => selected,
    toggle(event: CalendarEvent) {
      const next = new Map(selected);
      const key = eventKey(event);
      if (!next.delete(key)) next.set(key, event);
      replace(next);
    },
    select(events: CalendarEvent[]) {
      const next = new Map(events.map((e) => [eventKey(e), e]));
      const unchanged =
        next.size === selected.size &&
        [...next.keys()].every((k) => selected.has(k));

      if (!unchanged) replace(next);
    },
    clear() {
      if (selected.size > 0) replace(new Map());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type SelectionStore = ReturnType<typeof createSelectionStore>;
