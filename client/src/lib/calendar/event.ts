import type {
  CalendarEvent,
  EventStyle,
  PositionedEvent,
} from "@/types/calendar/Event";
import type { DateTime } from "luxon";

export const getDayEventStyles = (
  events: CalendarEvent[],
  day: DateTime,
  hourHeight: number,
): Record<string, EventStyle> => {
  const utcDay = day.setZone("utc", { keepLocalTime: true });
  const dayStart = utcDay.startOf("day");
  const dayEnd = utcDay.endOf("day");

  // map events to positions
  const positioned: PositionedEvent[] = events
    .map((ev) => {
      const utcEvStart = ev.start.setZone("utc", { keepLocalTime: true });
      const utcEvEnd = ev.end.setZone("utc", { keepLocalTime: true });
      const start = utcEvStart < dayStart ? dayStart : utcEvStart;
      const end = utcEvEnd > dayEnd ? dayEnd : utcEvEnd;

      return {
        id: ev.id,
        start: ev.start,
        end: ev.end,
        top: Math.max(
          0,
          (start.diff(dayStart, "minutes").minutes / 60) * hourHeight,
        ),
        height: Math.max(
          0,
          (end.diff(start, "minutes").minutes / 60) * hourHeight,
        ),
        col: -1,
        maxCols: 1,
      } as PositionedEvent;
    })
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
