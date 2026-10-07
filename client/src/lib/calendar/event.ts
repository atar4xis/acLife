import type {
  CalendarEvent,
  EventNotification,
  EventStyle,
  PositionedEvent,
} from "@/types/calendar/Event";
import type { DateTime, Duration } from "luxon";
import {
  nominalOnDate,
  occurrences,
  slotKey,
} from "@/lib/calendar/occurrences";

export const eventKey = (event: CalendarEvent) => event._instanceId ?? event.id;

export const stateTargets = (
  state: { event: CalendarEvent | null; day: number | null },
  event: CalendarEvent,
  day: number,
) =>
  !!state.event &&
  eventKey(state.event) === eventKey(event) &&
  state.day === day;

export const MAX_EVENT_DURATION_MINUTES = 4 * 7 * 24 * 60; // 4 weeks

export function getEventPixelPosition(
  event: CalendarEvent,
  day: DateTime,
  hourHeight: number,
) {
  const utcDay = day.setZone("utc", { keepLocalTime: true });
  const dayStart = utcDay.startOf("day");
  const dayEnd = utcDay.endOf("day");

  const utcStart = event.start.setZone("utc", { keepLocalTime: true });
  const utcEnd = event.end.setZone("utc", { keepLocalTime: true });

  const start = utcStart < dayStart ? dayStart : utcStart;
  const end = utcEnd > dayEnd ? dayEnd : utcEnd;

  const top = Math.max(
    0,
    (start.diff(dayStart, "minutes").as("minutes") / 60) * hourHeight,
  );
  const height = Math.max(
    5,
    (end.diff(start, "minutes").as("minutes") / 60) * hourHeight,
  );

  return {
    ...event,
    top,
    height,
    col: -1,
    maxCols: 1,
  } as PositionedEvent;
}

const dayStylesCache = new WeakMap<
  CalendarEvent[],
  { hourHeight: number; result: Record<string, EventStyle> }
>();

export const getDayEventStyles = (
  events: CalendarEvent[],
  day: DateTime,
  hourHeight: number,
): Record<string, EventStyle> => {
  const cached = dayStylesCache.get(events);
  if (cached && cached.hourHeight === hourHeight) return cached.result;

  // map events to positions
  const positioned: PositionedEvent[] = events
    .map((ev) => getEventPixelPosition(ev, day, hourHeight))
    .toSorted((a, b) => a.start.toMillis() - b.start.toMillis());

  const columns: PositionedEvent[][] = [];

  for (const ev of positioned) {
    let placed = false;

    // try to place event in the first column with no overlap
    for (let colIndex = 0; colIndex < columns.length; colIndex++) {
      const col = columns[colIndex];
      const lastInCol = col[col.length - 1];
      if (ev.start >= lastInCol.end) {
        col.push(ev);
        ev.col = colIndex;
        placed = true;
        break;
      }
    }

    if (!placed) {
      columns.push([ev]);
      ev.col = columns.length - 1;
    }
  }

  // calculate maxCols per overlapping group
  const overlapGroups: PositionedEvent[][] = [];

  for (const ev of positioned) {
    let added = false;
    for (const group of overlapGroups) {
      if (group.some((g) => ev.start < g.end && ev.end > g.start)) {
        group.push(ev);
        added = true;
        break;
      }
    }
    if (!added) overlapGroups.push([ev]);
  }

  // assign maxCols per group
  for (const group of overlapGroups) {
    const groupColumns: PositionedEvent[][] = [];
    for (const ev of group) {
      let placed = false;
      for (let i = 0; i < groupColumns.length; i++) {
        const col = groupColumns[i];
        if (ev.start >= col[col.length - 1].end) {
          col.push(ev);
          ev.col = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        groupColumns.push([ev]);
        ev.col = groupColumns.length - 1;
      }
    }

    const maxCols = groupColumns.length;
    for (const ev of group) ev.maxCols = maxCols;
  }

  // build final styles
  const styles: Record<string, EventStyle> = {};
  for (const ev of positioned) {
    const width = 100 / ev.maxCols;
    styles[eventKey(ev)] = {
      top: ev.top,
      height: ev.height,
      width,
      left: ev.col * width,
    };
  }

  dayStylesCache.set(events, { hourHeight, result: styles });

  return styles;
};

export const resolveInstanceCompleted = (
  event: CalendarEvent,
  dateKey: string,
) =>
  event.repeat
    ? (event.completedInstances?.includes(dateKey) ?? false)
    : event.completed;

export const sameNotifications = (
  a: EventNotification[] = [],
  b: EventNotification[] = [],
) => JSON.stringify(a) === JSON.stringify(b);

export const makeOccurrence = (
  event: CalendarEvent,
  start: DateTime,
  key: string,
  duration: Duration,
): CalendarEvent => {
  const slot = slotKey(start);
  const override = event.repeat?.overrides?.[slot];
  const {
    startShift = 0,
    endShift = 0,
    description,
    color,
    title,
    allDay,
    notifications,
  } = override ?? {};

  return {
    ...event,
    title: title ?? event.title,
    description:
      description === undefined
        ? event.description
        : (description ?? undefined),
    color: color === undefined ? event.color : (color ?? undefined),
    allDay: allDay ?? event.allDay,
    notifications: notifications ?? event.notifications,
    _instanceId: `${event.id}_${key}`,
    start: start.plus(startShift),
    end: start.plus(duration).plus(endShift),
    _parent: event.id,
    _overrideKey: slot,
    _resettable: override ? true : undefined,
    completed: event.isTask ? resolveInstanceCompleted(event, key) : undefined,
  };
};

export function mapEventToDate(
  map: Map<string, CalendarEvent[]>,
  key: string,
  event: CalendarEvent,
) {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(event);
}

export function mapEventToDates(
  map: Map<string, CalendarEvent[]>,
  event: CalendarEvent,
  visibleDates: Set<string | null>,
) {
  let day = event.start.startOf("day");
  const firstDay = day;
  const lastDay = event.end.startOf("day");

  while (day.toMillis() <= lastDay.toMillis()) {
    const key = day.toISODate()!;
    if (visibleDates.has(key)) {
      mapEventToDate(map, key, {
        ...event,
        _continued: day.toMillis() !== firstDay.toMillis(),
      });
    }
    day = day.plus({ days: 1 });
  }
}

function processRepeats(
  map: Map<string, CalendarEvent[]>,
  e: CalendarEvent,
  visibleDates: Set<string>,
  firstVisibleDayStart: DateTime,
  lastVisibleDayEnd: DateTime,
  excludeSet: Set<string>,
) {
  if (!e.repeat || e._parent || e._continued) return;

  const duration = e.end.diff(e.start);
  const startMillis = e.start.toMillis();
  const overrides = e.repeat.overrides;
  const pad = Math.max(
    0,
    ...Object.values(overrides ?? {}).flatMap((o) => [
      Math.abs(o.startShift ?? 0),
      Math.abs(o.endShift ?? 0),
    ]),
  );

  const emit = (cursor: DateTime) => {
    const key = cursor.toISODate()!;

    if (
      (visibleDates.has(key) || overrides?.[slotKey(cursor)]) &&
      !excludeSet.has(`${e.id}_${key}`)
    ) {
      mapEventToDates(
        map,
        makeOccurrence(e, cursor, key, duration),
        visibleDates,
      );
    }
  };

  // overrides before the anchor are left behind when the parent moves forward
  const anchorKey = slotKey(e.start);
  for (const key of Object.keys(overrides ?? {})) {
    if (key < anchorKey) emit(nominalOnDate(e.start, key));
  }

  for (const cursor of occurrences(
    e.start,
    e.repeat,
    firstVisibleDayStart.minus(pad),
  )) {
    if (cursor > lastVisibleDayEnd.plus(pad)) break;
    if (cursor.toMillis() !== startMillis) emit(cursor);
  }
}

type Placement = [key: string, event: CalendarEvent];

type BaseEventMapCache = {
  events?: CalendarEvent[];
  dates?: DateTime[];
  result?: Map<string, CalendarEvent[]>;
};

const baseEventMapCache: BaseEventMapCache = {};

const WINDOW_PAD_MS = 4 * 24 * 60 * 60 * 1000;
const MAX_CACHED_WINDOWS = 4;

// per source event and window: reducer keeps unchanged events' identity, so only changed events are expanded again
const placementCache = new WeakMap<CalendarEvent, Map<string, Placement[]>>();

// last result per window: day arrays with unchanged contents keep identity so memoized consumers skip work
const windowResults = new Map<string, Map<string, CalendarEvent[]>>();

const sameItems = (a: CalendarEvent[], b: CalendarEvent[]) =>
  a.length === b.length && a.every((e, i) => e === b[i]);

function expandEvent(
  e: CalendarEvent,
  visibleDates: Set<string>,
  firstVisibleDayStart: DateTime,
  lastVisibleDayEnd: DateTime,
  outsideWindow: boolean,
) {
  const map = new Map<string, CalendarEvent[]>();

  if (!outsideWindow) {
    const base =
      e.isTask && e.repeat
        ? {
            ...e,
            completed: resolveInstanceCompleted(e, e.start.toISODate()!),
          }
        : e;

    mapEventToDates(map, base, visibleDates);
  }

  processRepeats(
    map,
    e,
    visibleDates,
    firstVisibleDayStart,
    lastVisibleDayEnd,
    new Set(),
  );

  const placements: Placement[] = [];
  for (const [key, dayEvents] of map) {
    for (const ev of dayEvents) placements.push([key, ev]);
  }
  return placements;
}

function getBaseEventMap(events: CalendarEvent[], dates: DateTime[]) {
  if (
    baseEventMapCache.result &&
    baseEventMapCache.events === events &&
    baseEventMapCache.dates === dates
  ) {
    return baseEventMapCache.result;
  }

  const keys = dates.map((d) => d.toISODate()!);
  const visibleDates = new Set(keys);
  const windowKey = `${dates[0].zoneName}|${keys.join()}`;

  const firstVisibleDayStart = dates[0].startOf("day");
  const lastVisibleDayEnd = dates[dates.length - 1].endOf("day");

  // padded so events near the edge survive whatever zone their days are in
  const windowStart = firstVisibleDayStart.toMillis() - WINDOW_PAD_MS;
  const windowEnd = lastVisibleDayEnd.toMillis() + WINDOW_PAD_MS;

  const map = new Map<string, CalendarEvent[]>();

  for (const e of events) {
    if (!e.id) continue;

    // events clear of the visible days have nothing to place, repeats still expand
    const outsideWindow =
      e.end.toMillis() < windowStart || e.start.toMillis() > windowEnd;
    if (outsideWindow && !e.repeat) continue;

    let windows = placementCache.get(e);
    if (!windows) placementCache.set(e, (windows = new Map()));

    let placements = windows.get(windowKey);
    if (!placements) {
      placements = expandEvent(
        e,
        visibleDates,
        firstVisibleDayStart,
        lastVisibleDayEnd,
        outsideWindow,
      );
      if (windows.size >= MAX_CACHED_WINDOWS)
        windows.delete(windows.keys().next().value!);
      windows.set(windowKey, placements);
    }

    for (const [key, ev] of placements) mapEventToDate(map, key, ev);
  }

  const previous = windowResults.get(windowKey);
  if (previous) {
    for (const [key, dayEvents] of map) {
      const before = previous.get(key);
      if (before && sameItems(before, dayEvents)) map.set(key, before);
    }
  }
  windowResults.delete(windowKey);
  windowResults.set(windowKey, map);
  if (windowResults.size > MAX_CACHED_WINDOWS)
    windowResults.delete(windowResults.keys().next().value!);

  baseEventMapCache.events = events;
  baseEventMapCache.dates = dates;
  baseEventMapCache.result = map;

  return map;
}

export function getEventMap(
  events: CalendarEvent[],
  dates: DateTime[],
  exclude: string[],
  append: CalendarEvent[],
) {
  const base = getBaseEventMap(events, dates);

  if (exclude.length === 0 && append.length === 0) return base;

  const excludeSet = new Set(exclude);
  const map = new Map<string, CalendarEvent[]>();

  for (const [key, dayEvents] of base) {
    const hasExcluded =
      excludeSet.size > 0 && dayEvents.some((e) => excludeSet.has(eventKey(e)));

    map.set(
      key,
      hasExcluded
        ? dayEvents.filter((e) => !excludeSet.has(eventKey(e)))
        : dayEvents,
    );
  }

  if (append.length > 0) {
    const visibleDates = new Set<string>();
    for (const d of dates) {
      visibleDates.add(d.toISODate()!);
    }
    const firstVisibleDayStart = dates[0].startOf("day");
    const lastVisibleDayEnd = dates[dates.length - 1].endOf("day");

    const additions = new Map<string, CalendarEvent[]>();
    for (const e of append) {
      if (!e.id) continue;

      mapEventToDates(additions, e, visibleDates);
      processRepeats(
        additions,
        e,
        visibleDates,
        firstVisibleDayStart,
        lastVisibleDayEnd,
        excludeSet,
      );
    }

    for (const [key, added] of additions) {
      const existing = map.get(key);
      map.set(key, existing ? [...existing, ...added] : added);
    }
  }

  return map;
}
