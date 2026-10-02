import type { DateTime } from "luxon";
import type { Dispatch } from "react";
import type {
  CalendarEvent,
  EventChange,
  RepeatInterval,
} from "@/types/calendar/Event";
import type { CalendarAction } from "@/types/calendar/Action";
import { makeOccurrence } from "@/lib/calendar/event";
import { occurrences } from "@/lib/calendar/occurrences";

export const isChainParent = (event: CalendarEvent) =>
  !event._parent && !!event.repeat;

export function moveToFirstOccurrence(
  start: DateTime,
  end: DateTime,
  repeat?: RepeatInterval,
) {
  const first = repeat && occurrences(start, repeat).next().value;
  return first && first > start
    ? { start: first, end: first.plus(end.diff(start)) }
    : null;
}

export function nextOccurrence(
  repeat: RepeatInterval,
  start: DateTime,
  end: DateTime,
) {
  for (const next of occurrences(start, repeat, start)) {
    if (next > start) return { start: next, end: next.plus(end.diff(start)) };
  }
  return null;
}

export function occurrencesBefore(
  start: DateTime,
  repeat: RepeatInterval,
  date: DateTime,
) {
  let found = 0;
  for (const d of occurrences(start, repeat)) {
    if (d >= date) break;
    found++;
  }
  return found;
}

const MAX_LOOKBACK_PERIODS = 1600;

export function nearbyOccurrences(
  event: CalendarEvent,
  now: DateTime,
  perSide: number,
): CalendarEvent[] {
  const repeat = event.repeat;
  if (!repeat || event._parent) return [event];

  const duration = event.end.diff(event.start);
  const toEvent = (start: DateTime) =>
    start.toMillis() === event.start.toMillis()
      ? event
      : makeOccurrence(event, start, start.toISODate()!, duration);

  const after: DateTime[] = [];
  for (const start of occurrences(event.start, repeat, now)) {
    if (after.length >= perSide) break;
    after.push(start);
  }

  let before: DateTime[] = [];
  for (
    let periods = perSide * 2;
    periods <= MAX_LOOKBACK_PERIODS;
    periods *= 4
  ) {
    const from = now.minus({ [repeat.unit]: periods * repeat.interval });
    before = [];
    for (const start of occurrences(event.start, repeat, from)) {
      if (start >= now) break;
      before.push(start);
    }
    if (before.length >= perSide || from <= event.start) break;
  }

  return [...before.slice(-perSide), ...after].map(toEvent);
}

export function skipSingleOccurrence(
  event: CalendarEvent,
  calendarEvents: CalendarEvent[],
  dispatch: Dispatch<CalendarAction>,
  updateChange: (change: EventChange) => void,
): CalendarEvent | undefined {
  const isParent = isChainParent(event);
  const parentId = isParent ? event.id : event._parent;

  const originalParent = calendarEvents.find((e) => e.id === parentId);

  if (!originalParent?.repeat) {
    dispatch({ type: "delete", id: event.id });
    updateChange({ id: event.id, type: "deleted" });
    return;
  }

  const parent = { ...originalParent };

  if (isParent) {
    const next = nextOccurrence(parent.repeat!, event.start, event.end);

    if (!next) {
      dispatch({ type: "delete", id: parent.id });
      updateChange({ id: parent.id, type: "deleted" });
      return;
    }

    parent.start = next.start;
    parent.end = next.end;
  } else {
    parent.repeat = {
      ...parent.repeat!,
      skip: [...(parent.repeat!.skip ?? []), event.start.toUTC().toISODate()!],
    };
  }

  dispatch({ type: "update", id: parent.id, data: parent });
  updateChange({ type: "updated", event: parent });

  return parent;
}

export function detachSingleOccurrence(
  event: CalendarEvent,
  originalStart: DateTime,
  originalEnd: DateTime,
  calendarEvents: CalendarEvent[],
  dispatch: Dispatch<CalendarAction>,
  updateChange: (change: EventChange) => void,
): CalendarEvent | undefined {
  const isParent = isChainParent(event);
  const parentId = isParent ? event.id : event._parent;

  const originalParent = calendarEvents.find((e) => e.id === parentId);

  if (!originalParent?.repeat) {
    dispatch({ type: "update", id: event.id, data: event });
    updateChange({ type: "updated", event });
    return;
  }

  const newEvent = {
    ...event,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  } as CalendarEvent;

  const parent = { ...originalParent };
  let parentEnded = false;

  if (isParent) {
    // move parent to its next occurrence, skipping excluded weekdays/dates
    const next = nextOccurrence(parent.repeat!, originalStart, originalEnd);

    if (next) {
      parent.start = next.start;
      parent.end = next.end;
    } else {
      parentEnded = true;
    }
  } else {
    // skip this occurrence on the parent
    parent.repeat = {
      ...parent.repeat!,
      skip: [
        ...(parent.repeat!.skip ?? []),
        originalStart.toUTC().toISODate()!,
      ],
    };
  }

  if (parentEnded) {
    updateChange({ id: parent.id, type: "deleted" });
    dispatch({ type: "delete", id: parent.id });
  } else {
    updateChange({ type: "updated", event: parent });
    dispatch({ type: "update", id: parent.id, data: parent });
  }

  delete newEvent._parent; // detach from parent
  delete newEvent.repeat; // don't repeat

  dispatch({ type: "add", event: newEvent });
  updateChange({ type: "added", event: newEvent });

  return parentEnded ? undefined : parent;
}
