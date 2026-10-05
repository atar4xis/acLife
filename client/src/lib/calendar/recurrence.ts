import { DateTime } from "luxon";
import type { Dispatch } from "react";
import type {
  CalendarEvent,
  EventChange,
  OccurrenceOverride,
  RepeatInterval,
} from "@/types/calendar/Event";
import type { CalendarAction } from "@/types/calendar/Action";
import { eventKey, makeOccurrence } from "@/lib/calendar/event";
import {
  nominalOnDate,
  occurrences,
  slotKey,
} from "@/lib/calendar/occurrences";

export const isChainParent = (event: CalendarEvent) =>
  !event._parent && !!event.repeat;

export const overrideKey = (event: CalendarEvent) => event._overrideKey ?? "";

const standalone = (event: CalendarEvent) =>
  Object.fromEntries(
    Object.entries(event).filter(([key]) => !key.startsWith("_")),
  ) as CalendarEvent;

const isEmptyOverride = (override: OccurrenceOverride) =>
  Object.values(override).every((v) => v === undefined || v === 0);

const withOverride = (
  repeat: RepeatInterval,
  key: string,
  override?: OccurrenceOverride,
): RepeatInterval => {
  const overrides = { ...repeat.overrides };
  delete overrides[key];
  if (override && !isEmptyOverride(override)) {
    overrides[key] = override;
  }
  return {
    ...repeat,
    overrides: Object.keys(overrides).length ? overrides : undefined,
  };
};

function promoteNext(parent: CalendarEvent) {
  const repeat = parent.repeat!;
  let consumed = 0;
  for (const d of occurrences(parent.start, repeat)) {
    consumed++;
    if (d > parent.start && !repeat.overrides?.[slotKey(d)]) {
      return {
        start: d,
        end: d.plus(parent.end.diff(parent.start)),
        left: consumed - 1,
      };
    }
  }
  return null;
}

// occurrences behind the new anchor leave the series count unless still shown
function shiftAnchor(
  parent: CalendarEvent,
  next: NonNullable<ReturnType<typeof promoteNext>>,
  oldStillShown: boolean,
): CalendarEvent {
  const { count } = parent.repeat!;
  return {
    ...parent,
    start: next.start,
    end: next.end,
    repeat: {
      ...parent.repeat!,
      count: count && count - next.left + (oldStillShown ? 0 : 1),
    },
  };
}

export const withShiftedOverrides = (
  original: CalendarEvent,
  event: CalendarEvent,
) =>
  event.repeat
    ? {
        ...event,
        repeat: {
          ...event.repeat,
          overrides:
            original.repeat &&
            shiftOverrides(
              original.repeat.overrides,
              moveKey(
                original.start,
                event.start,
                dayOffset(event.start, original.start),
              ),
            ),
        },
      }
    : event;

export const shiftOverrides = (
  overrides: Record<string, OccurrenceOverride> | undefined,
  mapKey: (key: string) => string,
) => {
  if (!overrides) return overrides;
  return Object.fromEntries(
    Object.entries(overrides).map(([key, o]) => [mapKey(key), o]),
  );
};

function regenerated(
  parent: CalendarEvent,
  key: string,
  repeat: RepeatInterval,
) {
  const anchor = nominalOnDate(parent.start, key);
  const region: DateTime[] = [];
  for (const d of occurrences(anchor, {
    ...repeat,
    count: undefined,
    until: undefined,
  })) {
    if (d >= parent.start) break;
    region.push(d);
  }
  if (region[0]?.toMillis() !== anchor.toMillis()) return null;

  const skip: string[] = [];
  let shown = 0;
  for (const d of region) {
    if (d === region[0] || repeat.overrides?.[slotKey(d)]) shown++;
    else skip.push(d.toUTC().toISODate()!);
  }
  return { anchor, skip, shown };
}

const dayOffset = (to: DateTime, from: DateTime) =>
  Math.round(to.startOf("day").diff(from.startOf("day"), "days").days);

// per occurrence, since a time change crosses UTC midnight in only some DST seasons
const moveKey = (from: DateTime, to: DateTime, days: number) => (key: string) =>
  slotKey(
    nominalOnDate(from, key).plus({ days }).set({
      hour: to.hour,
      minute: to.minute,
      second: to.second,
      millisecond: to.millisecond,
    }),
  );

const nominalOf = (parent: CalendarEvent, event: CalendarEvent) =>
  event._overrideKey
    ? nominalOnDate(parent.start, event._overrideKey)
    : event.start;

export const cutPoint = (parent: CalendarEvent, event: CalendarEvent) =>
  DateTime.min(nominalOf(parent, event), event.start).startOf("day");

export function splitSeries(
  parent: CalendarEvent,
  event: CalendarEvent,
  keepChanges: boolean,
) {
  const repeat = parent.repeat!;
  const key = overrideKey(event);
  const nominal = nominalOf(parent, event);
  const preAnchor = !!event._overrideKey && key < slotKey(parent.start);
  const days = dayOffset(event.start, nominal);
  const cut = cutPoint(parent, event);
  const kept = repeat.count ? occurrencesBefore(parent.start, repeat, cut) : 0;
  const back = preAnchor && regenerated(parent, key, repeat);
  const cutKey = nominal.toUTC().toISODate()!;
  const skip = [
    ...(repeat.skip ?? []).filter((d) => d >= cutKey),
    ...(back ? back.skip : []),
  ].map(moveKey(parent.start, event.start, days));

  // clone the event
  const created = standalone({
    ...event,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    repeat: {
      ...repeat,
      skip: skip.length ? skip : undefined,
      overrides: keepChanges ? futureOverrides(parent, event) : undefined,
      count: repeat.count && repeat.count - kept + (back ? back.shown : 0),
    },
  } as CalendarEvent);

  // end parent's repetition
  const remaining = preAnchor
    ? null
    : {
        ...parent,
        repeat: {
          ...repeat,
          ...(repeat.count ? { count: kept } : { until: cut.toMillis() }),
          overrides: overridesBefore(parent, event),
        },
      };
  return { created, remaining };
}

export function resetOccurrence(
  event: CalendarEvent,
  calendarEvents: CalendarEvent[],
  dispatch: Dispatch<CalendarAction>,
  updateChange: (change: EventChange) => void,
) {
  const original = calendarEvents.find((e) => e.id === event._parent);
  if (!original?.repeat) return;

  const key = overrideKey(event);
  let { start, end } = original;
  let repeat = withOverride(original.repeat, key);

  // an override left behind a promoted parent restores the parent to its date
  const back = key < slotKey(start) && regenerated(original, key, repeat);
  if (back) {
    end = back.anchor.plus(end.diff(start));
    start = back.anchor;
    const skip = [...(repeat.skip ?? []), ...back.skip];
    repeat = {
      ...repeat,
      skip: skip.length ? skip : undefined,
      count: repeat.count && repeat.count + back.shown,
    };
  }

  const parent = { ...original, start, end, repeat, timestamp: Date.now() };
  dispatch({ type: "update", id: parent.id, data: parent });
  updateChange({ type: "updated", event: parent });
}

export function futureOverrides(parent: CalendarEvent, event: CalendarEvent) {
  const key = overrideKey(event);
  const later = Object.fromEntries(
    Object.entries(parent.repeat?.overrides ?? {}).filter(([k]) => k > key),
  );
  const moved = shiftOverrides(
    later,
    moveKey(
      parent.start,
      event.start,
      dayOffset(event.start, nominalOnDate(parent.start, key)),
    ),
  );
  return moved && Object.keys(moved).length ? moved : undefined;
}

function keepAsEvents(
  parent: CalendarEvent,
  keys: string[],
  dispatch: Dispatch<CalendarAction>,
  updateChange: (change: EventChange) => void,
) {
  const duration = parent.end.diff(parent.start);
  for (const key of keys) {
    const nominal = nominalOnDate(parent.start, key);
    const kept = standalone({
      ...makeOccurrence(parent, nominal, nominal.toISODate()!, duration),
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    });
    delete kept.repeat;

    dispatch({ type: "add", event: kept });
    updateChange({ type: "added", event: kept });
  }
}

export function endSeriesBefore(
  parent: CalendarEvent,
  event: CalendarEvent,
  dispatch: Dispatch<CalendarAction>,
  updateChange: (change: EventChange) => void,
) {
  const key = overrideKey(event);
  if (key >= slotKey(parent.start)) return false;

  dispatch({ type: "delete", id: parent.id });
  updateChange({ id: parent.id, type: "deleted" });
  keepAsEvents(
    parent,
    Object.keys(parent.repeat?.overrides ?? {}).filter((k) => k < key),
    dispatch,
    updateChange,
  );
  return true;
}

export function overridesBefore(parent: CalendarEvent, event: CalendarEvent) {
  const key = overrideKey(event);
  const kept = Object.fromEntries(
    Object.entries(parent.repeat?.overrides ?? {}).filter(([k]) => k < key),
  );
  return Object.keys(kept).length ? kept : undefined;
}

export function overrideOccurrences(event: CalendarEvent) {
  const overrides = event._parent ? undefined : event.repeat?.overrides;
  if (!overrides) return [];

  const duration = event.end.diff(event.start);
  return Object.keys(overrides).map((key) => {
    const nominal = nominalOnDate(event.start, key);
    return makeOccurrence(event, nominal, nominal.toISODate()!, duration);
  });
}

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
  accept: (occurrence: CalendarEvent) => boolean = () => true,
): CalendarEvent[] {
  const repeat = event.repeat;
  if (!repeat || event._parent) return [event];

  const reach = perSide + Object.keys(repeat.overrides ?? {}).length;

  const duration = event.end.diff(event.start);
  const toEvent = (start: DateTime) =>
    start.toMillis() === event.start.toMillis()
      ? event
      : makeOccurrence(event, start, start.toISODate()!, duration);

  const after: DateTime[] = [];
  for (const start of occurrences(event.start, repeat, now)) {
    if (after.length >= reach) break;
    after.push(start);
  }

  let before: DateTime[] = [];
  for (let periods = reach * 2; periods <= MAX_LOOKBACK_PERIODS; periods *= 4) {
    const from = now.minus({ [repeat.unit]: periods * repeat.interval });
    before = [];
    for (const start of occurrences(event.start, repeat, from)) {
      if (start >= now) break;
      before.push(start);
    }
    if (before.length >= reach || from <= event.start) break;
  }

  const generated = [...before.slice(-reach), ...after].map(toEvent);
  if (!repeat.overrides) return generated;

  // overrides may sit before the anchor or be moved, so pick by shown time
  const all = new Map(
    [...generated, ...overrideOccurrences(event)]
      .filter(accept)
      .map((e) => [eventKey(e), e]),
  );
  return closestToNow([...all.values()], now, perSide);
}

function closestToNow(events: CalendarEvent[], now: DateTime, perSide: number) {
  const sorted = events.toSorted(
    (a, b) => a.start.toMillis() - b.start.toMillis(),
  );
  const split = sorted.findIndex((e) => e.start >= now);
  const at = split === -1 ? sorted.length : split;
  return [
    ...sorted.slice(Math.max(0, at - perSide), at),
    ...sorted.slice(at, at + perSide),
  ];
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

  let parent = { ...originalParent };

  if (isParent) {
    const next = promoteNext(parent);

    if (!next) {
      dispatch({ type: "delete", id: parent.id });
      updateChange({ id: parent.id, type: "deleted" });
      return;
    }

    parent = shiftAnchor(parent, next, false);
  } else {
    parent.repeat = {
      ...withOverride(parent.repeat!, overrideKey(event)),
      skip: [
        ...(parent.repeat!.skip ?? []),
        nominalOf(originalParent, event).toUTC().toISODate()!,
      ],
    };
  }

  dispatch({ type: "update", id: parent.id, data: parent });
  updateChange({ type: "updated", event: parent });

  return parent;
}

export function detachSingleOccurrence(
  event: CalendarEvent,
  originalStart: DateTime,
  calendarEvents: CalendarEvent[],
  dispatch: Dispatch<CalendarAction>,
  updateChange: (change: EventChange) => void,
  detach = true,
): CalendarEvent | undefined {
  const isParent = isChainParent(event);
  const parentId = isParent ? event.id : event._parent;

  const originalParent = calendarEvents.find((e) => e.id === parentId);

  if (!originalParent?.repeat) {
    dispatch({ type: "update", id: event.id, data: event });
    updateChange({ type: "updated", event });
    return;
  }

  const duration = originalParent.end.diff(originalParent.start);
  // repeat settings belong to the series, so a parent edit applies them to it
  const repeat =
    isParent && !detach
      ? {
          ...(event.repeat ?? originalParent.repeat),
          overrides: originalParent.repeat.overrides,
        }
      : originalParent.repeat;
  const next = isParent ? promoteNext({ ...originalParent, repeat }) : null;

  if (!detach) {
    const key = isParent ? slotKey(originalStart) : overrideKey(event);
    const nominal = nominalOnDate(next?.start ?? originalParent.start, key);
    const override: OccurrenceOverride = {
      startShift: event.start.toMillis() - nominal.toMillis(),
      endShift: event.end.toMillis() - nominal.plus(duration).toMillis(),
    };
    if (event.title !== originalParent.title) override.title = event.title;
    if (event.description !== originalParent.description) {
      override.description = event.description ?? null;
    }
    if (event.color !== originalParent.color) {
      override.color = event.color ?? null;
    }
    if (!!event.allDay !== !!originalParent.allDay) {
      override.allDay = !!event.allDay;
    }

    const untouched = isEmptyOverride(override);
    if (isParent && (untouched || next)) {
      const edited = {
        ...originalParent,
        repeat: untouched
          ? repeat
          : { ...repeat, overrides: { ...repeat.overrides, [key]: override } },
      };
      const parent = {
        ...(untouched || !next ? edited : shiftAnchor(edited, next, true)),
        timestamp: Date.now(),
      };
      dispatch({ type: "update", id: parent.id, data: parent });
      updateChange({ type: "updated", event: parent });
      return parent;
    }

    if (!isParent) {
      const parent = {
        ...originalParent,
        repeat: withOverride(repeat, key, override),
        timestamp: Date.now(),
      };
      dispatch({ type: "update", id: parent.id, data: parent });
      updateChange({ type: "updated", event: parent });
      return parent;
    }
  }

  const newEvent = standalone({
    ...event,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  });
  delete newEvent.repeat; // don't repeat

  let parent = { ...originalParent };
  let parentEnded = false;

  if (isParent) {
    // move parent to its next occurrence, skipping excluded weekdays/dates
    if (next) {
      parent = shiftAnchor(parent, next, false);
    } else {
      parentEnded = true;
    }
  } else {
    // skip this occurrence on the parent
    parent.repeat = {
      ...withOverride(parent.repeat!, overrideKey(event)),
      skip: [
        ...(parent.repeat!.skip ?? []),
        nominalOf(originalParent, event).toUTC().toISODate()!,
      ],
    };
  }

  if (parentEnded) {
    updateChange({ id: parent.id, type: "deleted" });
    dispatch({ type: "delete", id: parent.id });

    keepAsEvents(
      originalParent,
      Object.keys(originalParent.repeat.overrides ?? {}),
      dispatch,
      updateChange,
    );
  } else {
    updateChange({ type: "updated", event: parent });
    dispatch({ type: "update", id: parent.id, data: parent });
  }

  dispatch({ type: "add", event: newEvent });
  updateChange({ type: "added", event: newEvent });

  return parentEnded ? undefined : parent;
}
