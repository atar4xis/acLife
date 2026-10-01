import type { DateTime } from "luxon";
import type { Dispatch } from "react";
import type {
  CalendarEvent,
  EventChange,
  RepeatInterval,
} from "@/types/calendar/Event";
import type { CalendarAction } from "@/types/calendar/Action";
import { isOccurrenceExcluded, makeOccurrence } from "@/lib/calendar/event";

export const isChainParent = (event: CalendarEvent) =>
  !event._parent && !!event.repeat;

export function moveToIncludedDay(
  start: DateTime,
  end: DateTime,
  except?: number[],
) {
  let days = 0;
  while (except?.includes(start.plus({ days }).weekday)) days++;
  return days ? { start: start.plus({ days }), end: end.plus({ days }) } : null;
}

export function nextOccurrence(
  repeat: RepeatInterval,
  start: DateTime,
  end: DateTime,
) {
  const step = { [repeat.unit]: repeat.interval };
  let nextStart = start.plus(step);
  let nextEnd = end.plus(step);
  while (isOccurrenceExcluded(repeat, nextStart)) {
    nextStart = nextStart.plus(step);
    nextEnd = nextEnd.plus(step);
  }
  if (repeat.until && nextStart.toMillis() >= repeat.until) return null;
  return { start: nextStart, end: nextEnd };
}

const MAX_OCCURRENCE_SCAN = 400;

export function nearbyOccurrences(
  event: CalendarEvent,
  now: DateTime,
  perSide: number,
): CalendarEvent[] {
  const repeat = event.repeat;
  if (!repeat || event._parent) return [event];

  const { unit, interval, until } = repeat;
  const duration = event.end.diff(event.start);
  const nowIndex = Math.max(
    0,
    Math.ceil(now.diff(event.start, unit).as(unit) / interval),
  );

  const collect = (direction: 1 | -1) => {
    const found: CalendarEvent[] = [];
    let index = direction === 1 ? nowIndex : nowIndex - 1;
    for (
      let scanned = 0;
      index >= 0 && found.length < perSide && scanned < MAX_OCCURRENCE_SCAN;
      index += direction, scanned++
    ) {
      const start = event.start.plus({ [unit]: index * interval });
      if (until && start.toMillis() >= until) {
        if (direction === 1) break;
        continue;
      }
      if (isOccurrenceExcluded(repeat, start)) continue;
      found.push(
        index === 0
          ? event
          : makeOccurrence(event, start, start.toISODate()!, duration),
      );
    }
    return found;
  };

  return [...collect(-1), ...collect(1)];
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
