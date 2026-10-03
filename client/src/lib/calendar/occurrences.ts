import { DateTime } from "luxon";
import type {
  CalendarEvent,
  OccurrenceOverride,
  RepeatInterval,
} from "@/types/calendar/Event";

const MAX_EMPTY_PERIODS = 100;

export const isOccurrenceExcluded = (repeat: RepeatInterval, start: DateTime) =>
  !!repeat.except?.includes(start.weekday) ||
  !!repeat.skip?.includes(start.toUTC().toISODate()!);

export const slotKey = (start: DateTime) => start.toUTC().toISODate()!;

export const nominalOnDate = (anchor: DateTime, key: string) => {
  const on = (days: number) =>
    DateTime.fromISO(key, { zone: anchor.zone }).plus({ days }).set({
      hour: anchor.hour,
      minute: anchor.minute,
      second: anchor.second,
      millisecond: anchor.millisecond,
    });
  return [0, -1, 1].map(on).find((d) => slotKey(d) === key) ?? on(0);
};

export const overrideSpan = (
  anchor: Pick<CalendarEvent, "start" | "end">,
  key: string,
  override: OccurrenceOverride,
) => {
  const start = nominalOnDate(anchor.start, key);
  return {
    start: start.plus(override.startShift ?? 0),
    end: start.plus(anchor.end.diff(anchor.start)).plus(override.endShift ?? 0),
  };
};

const periodCandidates = (
  anchor: DateTime,
  repeat: RepeatInterval,
  period: number,
): DateTime[] => {
  const { unit, monthly, days, yearDays } = repeat;
  const step = period * repeat.interval;

  if (unit === "week" && days) {
    const week = anchor.plus({ weeks: step });
    return days.map((d) => week.plus({ days: d - week.weekday }));
  }

  if (unit === "month" && monthly) {
    const month = anchor.set({ day: 1 }).plus({ months: step });
    if (monthly === "date" || monthly === "days") {
      return (monthly === "date" ? [anchor.day] : (days ?? []))
        .filter((d) => d <= month.daysInMonth!)
        .map((d) => month.set({ day: d }));
    }

    const first = month.plus({
      days: (anchor.weekday - month.weekday + 7) % 7,
    });
    const nth = first.plus({ weeks: Math.ceil(anchor.day / 7) - 1 });
    const last = first.plus({
      weeks: Math.floor((month.daysInMonth! - first.day) / 7),
    });
    return [monthly === "nth" ? nth : last].filter(
      (d) => d.month === month.month,
    );
  }

  if (unit === "year" && yearDays) {
    const year = anchor.year + step;
    return yearDays.flatMap((md) => {
      const [m, d] = md.split("-").map(Number);
      const month = anchor.set({ year, month: m, day: 1 });
      return d <= month.daysInMonth! ? [month.set({ day: d })] : [];
    });
  }

  return [anchor.plus({ [unit]: step })];
};

// from only skips ahead; it never changes which occurrences exist
export function* occurrences(
  anchor: DateTime,
  repeat: RepeatInterval,
  from?: DateTime,
) {
  const { unit, interval, until, count } = repeat;
  let period = 0;
  if (from && !count) {
    const elapsed = from.diff(anchor, unit).as(unit);
    period = Math.max(0, Math.floor(elapsed / interval) - 1);
  }

  let found = 0;
  let empty = 0;
  for (; ; period++) {
    const starts = periodCandidates(anchor, repeat, period)
      .filter((d) => d >= anchor && !isOccurrenceExcluded(repeat, d))
      .toSorted((a, b) => a.toMillis() - b.toMillis());

    if (!starts.length) {
      if (++empty > MAX_EMPTY_PERIODS) return;
      continue;
    }
    empty = 0;

    for (const start of starts) {
      if (until && start.toMillis() >= until) return;
      if (count && ++found > count) return;
      if (!from || start >= from) yield start;
    }
  }
}
