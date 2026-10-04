import type { CalendarEvent } from "@/types/calendar/Event";
import type { DateTime, Duration } from "luxon";
import { makeOccurrence, resolveInstanceCompleted } from "./event";
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
  excludeKey: string,
): Occurrence | null {
  for (const e of events) {
    if (!e.id) continue;

    const candidates = e.repeat
      ? seriesOccurrences(e, rangeStart, rangeEnd)
      : [{ ...e, _instanceId: e.id }];

    for (const occ of candidates) {
      if (occ._instanceId === excludeKey) continue;
      if (occ.allDay || (occ.isTask && occ.completed)) continue;
      if (occ.start < rangeEnd && occ.end > rangeStart) {
        return { start: occ.start, end: occ.end };
      }
    }
  }

  return null;
}

/**
 * Searches forward or backward in time for the next slot, of the same
 * duration as `target`, that doesn't overlap any other event (or occurrence
 * of a repeating event).
 */
export function findFreeSlot(
  allEvents: CalendarEvent[],
  target: CalendarEvent,
  direction: "forward" | "backward",
): { start: DateTime; end: DateTime } | null {
  const duration: Duration = target.end.diff(target.start);
  const excludeKey = target._instanceId ?? target.id;

  let candidateStart =
    direction === "forward" ? target.end : target.start.minus(duration);

  const limit =
    direction === "forward"
      ? target.start.plus({ days: SEARCH_HORIZON_DAYS })
      : target.start.minus({ days: SEARCH_HORIZON_DAYS });

  for (let i = 0; i < MAX_CANDIDATES; i++) {
    if (
      direction === "forward" ? candidateStart > limit : candidateStart < limit
    ) {
      return null;
    }

    const candidateEnd = candidateStart.plus(duration);
    const conflict = findOverlappingOccurrence(
      allEvents,
      candidateStart,
      candidateEnd,
      excludeKey,
    );

    if (!conflict) {
      return { start: candidateStart, end: candidateEnd };
    }

    // skip straight past the conflicting occurrence instead of stepping
    // minute-by-minute
    candidateStart =
      direction === "forward" ? conflict.end : conflict.start.minus(duration);
  }

  return null;
}
