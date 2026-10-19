import type { CalendarEvent, EventChange } from "@/types/calendar/Event";

type PendingChanges = ReadonlyMap<string, EventChange[]>;

export const withoutPendingDeletes = (
  events: CalendarEvent[],
  pending: PendingChanges,
) => events.filter((ev) => pending.get(ev.id)?.at(-1)?.type !== "deleted");

export const withPendingChanges = (
  events: CalendarEvent[],
  pending: PendingChanges,
) => {
  if (pending.size === 0) return events;

  // the last pending change per id is what the user sees until it is acknowledged
  const last = new Map(
    Array.from(pending, ([id, changes]) => [id, changes.at(-1)!]),
  );
  const known = new Set(events.map((event) => event.id));

  const kept = events
    .filter((event) => last.get(event.id)?.type !== "deleted")
    .map((event) => last.get(event.id)?.event ?? event);
  const added = Array.from(last.values())
    .filter((change) => change.event && !known.has(change.event.id))
    .map((change) => change.event!);

  return [...kept, ...added];
};
