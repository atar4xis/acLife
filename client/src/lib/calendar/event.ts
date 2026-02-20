import type {
  CalendarEvent,
  EventStyle,
  PositionedEvent,
} from "@/types/calendar/Event";
import type { DateTime } from "luxon";

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
    id: event.id,
    start: event.start,
    end: event.end,
    top,
    height,
    col: -1,
    maxCols: 1,
  } as PositionedEvent;
}

export const getDayEventStyles = (
  events: CalendarEvent[],
  day: DateTime,
  hourHeight: number,
): Record<string, EventStyle> => {
  // map events to positions
  const positioned: PositionedEvent[] = events
    .map((ev) => getEventPixelPosition(ev, day, hourHeight))
    .sort((a, b) => a.start.toMillis() - b.start.toMillis());

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
    styles[ev.id] = {
      top: ev.top,
      height: ev.height,
      width,
      left: ev.col * width,
    };
  }

  return styles;
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
  lastVisibleDayEnd: DateTime,
  excludeSet: Set<string>,
) {
  if (!e.repeat || e._parent || e._continued) return;

  let cursor = e.start;
  const duration = e.end.diff(e.start);
  const until = e.repeat.until;
  const startMillis = e.start.toMillis();

  while (cursor <= lastVisibleDayEnd) {
    const millis = cursor.toMillis();

    if (millis !== startMillis) {
      const key = cursor.toISODate()!;
      const weekday = cursor.weekday;
      const id = `${e.id}_${key}`;

      if (
        visibleDates.has(key) &&
        (!until || millis < until) &&
        !e.repeat.except?.includes(weekday) &&
        !e.repeat.skip?.includes(key) &&
        !excludeSet.has(id)
      ) {
        const newEvent = {
          ...e,
          id,
          start: cursor,
          end: cursor.plus(duration),
          _parent: e.id,
        };

        mapEventToDates(map, newEvent, visibleDates);
      }
    }

    cursor = cursor.plus({
      [e.repeat.unit]: e.repeat.interval,
    });
  }
}

type EventMapCache = {
  events?: CalendarEvent[];
  dates?: DateTime[];
  exclude?: string[];
  append?: CalendarEvent[];
  result?: Map<string, CalendarEvent[]>;
};

const eventMapCache: EventMapCache = {};

export function getEventMap(
  events: CalendarEvent[],
  dates: DateTime[],
  exclude: string[],
  append: CalendarEvent[],
) {
  if (
    eventMapCache.result &&
    eventMapCache.events === events &&
    eventMapCache.dates === dates &&
    eventMapCache.exclude === exclude &&
    eventMapCache.append === append
  ) {
    return eventMapCache.result;
  }

  const map = new Map<string, CalendarEvent[]>();

  const visibleDates = new Set<string>();
  for (const d of dates) {
    visibleDates.add(d.toISODate()!);
  }

  const excludeSet = new Set(exclude);
  const lastVisibleDayEnd = dates[dates.length - 1].endOf("day");

  for (const e of events) {
    if (!e.id) continue;

    if (!excludeSet.has(e.id)) mapEventToDates(map, e, visibleDates);
    processRepeats(map, e, visibleDates, lastVisibleDayEnd, excludeSet);
  }

  for (const e of append) {
    if (!e.id) continue;

    mapEventToDates(map, e, visibleDates);
    processRepeats(map, e, visibleDates, lastVisibleDayEnd, excludeSet);
  }

  eventMapCache.events = events;
  eventMapCache.dates = dates;
  eventMapCache.exclude = exclude;
  eventMapCache.append = append;
  eventMapCache.result = map;

  return map;
}
