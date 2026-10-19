import type { CalendarEvent, EventChange } from "@/types/calendar/Event";
import { mayDelete, mayWrite } from "@/lib/shareInfo";
import { withoutRuntimeFields } from "@/lib/utils";
import type { OwnedSpace } from "@/types/Share";

export const MIRROR_BACKFILL_WEEKS = 104;

export const canEditEvent = (event: CalendarEvent) => mayWrite(event._shared);

export const canDeleteEvent = (event: CalendarEvent) =>
  mayDelete(event._shared);

export const persistable = (event: CalendarEvent) => {
  const stripped = withoutRuntimeFields(event) as CalendarEvent;
  return event._shared ? { ...stripped, _shared: event._shared } : stripped;
};

export const spaceOf = (change: EventChange) =>
  change.space ?? change.event?._shared?.space;

export const changeId = (change: EventChange) =>
  (change.event?.id ?? change.id)!;

export const isOwnEvent = (event: CalendarEvent) => !event._shared;

// a space without a target covers its whole collection
export const covers = (space: OwnedSpace, id: string) =>
  space.target === null || space.target === id;

export const mergeSources = (
  own: CalendarEvent[],
  shared: CalendarEvent[],
): CalendarEvent[] => {
  const ownIds = new Set(own.map((event) => event.id));
  const seen = new Set<string>();
  const extra = shared.filter((event) => {
    if (ownIds.has(event.id) || seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
  return [...own, ...extra];
};
