import type { CalendarEvent } from "@/types/calendar/Event";
import type { DateTime, Duration } from "luxon";
import { resolveInstanceCompleted } from "./event";

const SEARCH_HORIZON_DAYS = 365;
const MAX_CANDIDATES = 5000;
const MAX_REPEAT_ITERATIONS = 20000;

type Occurrence = { start: DateTime; end: DateTime };

/**
 * Finds the first occurrence (base or repeated) of any event other than
 * `excludeKey` that overlaps [rangeStart, rangeEnd). Mirrors the instance-id
 * scheme used by `processRepeats` in `lib/calendar/event.ts` so the moved
 * event's own occurrence can be excluded correctly.
 */
function findOverlappingOccurrence(
  events: CalendarEvent[],
  rangeStart: DateTime,
  rangeEnd: DateTime,
  excludeKey: string,
): Occurrence | null {
  for (const e of events) {
    if (!e.id) continue;

    if (!e.repeat) {
      if (e.id === excludeKey) continue;
      if (e.isTask && e.completed) continue;
      if (e.start < rangeEnd && e.end > rangeStart) {
        return { start: e.start, end: e.end };
      }
      continue;
    }

    const duration = e.end.diff(e.start);
    const until = e.repeat.until;
    let cursor = e.start;
    let iterations = 0;

    while (cursor <= rangeEnd && iterations < MAX_REPEAT_ITERATIONS) {
      iterations++;

      if (!until || cursor.toMillis() < until) {
        const key = cursor.toISODate()!;
        const keyUTC = cursor.toUTC().toISODate()!;
        const weekday = cursor.toUTC().weekday;
        const instanceId =
          cursor.toMillis() === e.start.toMillis() ? e.id : `${e.id}_${key}`;

        const skipped =
          e.repeat.except?.includes(weekday) ||
          e.repeat.skip?.includes(keyUTC) ||
          (e.isTask && resolveInstanceCompleted(e, key));

        if (!skipped && instanceId !== excludeKey) {
          const occEnd = cursor.plus(duration);
          if (cursor < rangeEnd && occEnd > rangeStart) {
            return { start: cursor, end: occEnd };
          }
        }
      }

      cursor = cursor.plus({ [e.repeat.unit]: e.repeat.interval });
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
    if (direction === "forward" ? candidateStart > limit : candidateStart < limit) {
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
      direction === "forward"
        ? conflict.end
        : conflict.start.minus(duration);
  }

  return null;
}
