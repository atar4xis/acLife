import type { CalendarEvent } from "@/types/calendar/Event";
import { DateTime, type Duration } from "luxon";
import { eventKey, makeOccurrence, resolveInstanceCompleted } from "./event";
import { nominalOnDate, occurrences, slotKey } from "./occurrences";

const SEARCH_HORIZON_DAYS = 365;
const MAX_CANDIDATES = 5000;

type Occurrence = { start: DateTime; end: DateTime };

// every occurrence of a series that may reach [rangeStart, rangeEnd], with overrides applied
function* seriesOccurrences(
  series: CalendarEvent,
  rangeStart: DateTime,
  rangeEnd: DateTime,
) {
  const repeat = series.repeat!;
  const duration = series.end.diff(series.start);
  const pad = Math.max(
    0,
    ...Object.values(repeat.overrides ?? {}).flatMap((o) => [
      Math.abs(o.startShift ?? 0),
      Math.abs(o.endShift ?? 0),
    ]),
  );
  const occurrence = (cursor: DateTime) =>
    makeOccurrence(series, cursor, cursor.toISODate()!, duration);

  // overrides before the anchor are left behind when the parent moves forward
  const anchorKey = slotKey(series.start);
  for (const key of Object.keys(repeat.overrides ?? {})) {
    if (key < anchorKey) yield occurrence(nominalOnDate(series.start, key));
  }

  for (const cursor of occurrences(
    series.start,
    repeat,
    rangeStart.minus(duration).minus(pad),
  )) {
    if (cursor > rangeEnd.plus(pad)) break;
    yield cursor.toMillis() === series.start.toMillis()
      ? {
          ...series,
          _instanceId: series.id,
          completed: series.isTask
            ? resolveInstanceCompleted(series, cursor.toISODate()!)
            : undefined,
        }
      : occurrence(cursor);
  }
}

function findOverlappingOccurrence(
  events: CalendarEvent[],
  rangeStart: DateTime,
  rangeEnd: DateTime,
  excludeKeys: Set<string>,
): Occurrence | null {
  for (const e of events) {
    if (!e.id) continue;

    const candidates = e.repeat
      ? seriesOccurrences(e, rangeStart, rangeEnd)
      : [{ ...e, _instanceId: e.id }];

    for (const occ of candidates) {
      if (excludeKeys.has(occ._instanceId!)) continue;
      if (occ.allDay || (occ.isTask && occ.completed)) continue;
      if (occ.start < rangeEnd && occ.end > rangeStart) {
        return { start: occ.start, end: occ.end };
      }
    }
  }

  return null;
}

export function findFreeSlot(
  allEvents: CalendarEvent[],
  target: CalendarEvent,
  direction: "forward" | "backward",
  group: CalendarEvent[] = [target],
): { start: DateTime; end: DateTime } | null {
  const duration: Duration = target.end.diff(target.start);
  const excludeKeys = new Set(group.map(eventKey));
  const movers = group.filter((e) => !e.allDay);
  const spanStart = DateTime.min(...group.map((e) => e.start))!;
  const spanEnd = DateTime.max(...group.map((e) => e.end))!;

  let shift =
    direction === "forward" ? spanEnd.diff(spanStart) : spanStart.diff(spanEnd);

  const limit =
    direction === "forward"
      ? target.start.plus({ days: SEARCH_HORIZON_DAYS })
      : target.start.minus({ days: SEARCH_HORIZON_DAYS });

  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const candidateStart = target.start.plus(shift);
    if (
      direction === "forward" ? candidateStart > limit : candidateStart < limit
    ) {
      return null;
    }

    let blocked = false;
    for (const ev of movers) {
      const start = ev.start.plus(shift);
      const end = ev.end.plus(shift);
      const conflict = findOverlappingOccurrence(
        allEvents,
        start,
        end,
        excludeKeys,
      );
      if (!conflict) continue;

      shift =
        direction === "forward"
          ? shift.plus(conflict.end.diff(start))
          : shift.minus(end.diff(conflict.start));
      blocked = true;
      break;
    }

    if (!blocked) {
      return { start: candidateStart, end: candidateStart.plus(duration) };
    }
  }

  return null;
}
