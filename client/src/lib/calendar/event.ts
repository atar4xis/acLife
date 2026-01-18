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
  const lastDay = event.end.startOf("day");

  while (day.toMillis() <= lastDay.toMillis()) {
    const key = day.toISODate()!;
    if (visibleDates.has(key)) {
      mapEventToDate(map, key, event);
    }
    day = day.plus({ days: 1 });
  }
}
