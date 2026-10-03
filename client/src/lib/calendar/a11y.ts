import type { DateTime } from "luxon";
import { fmt, t } from "@/i18n";
import { timeFormat } from "@/lib/calendar/date";
import type { CalendarEvent } from "@/types/calendar/Event";

const describeDay = (date: DateTime) => date.toFormat(fmt("dayFull"));

export const describeFullDay = (date: DateTime) =>
  date.toFormat(fmt("dayFullYear"));

const describeTime = (date: DateTime) => date.toFormat(timeFormat(date));

function describeTimeRange(start: DateTime, end: DateTime) {
  const sameMeridiem = start.toFormat("a") === end.toFormat("a");
  return t("a11y.range", {
    start: start.toFormat(timeFormat(start, !sameMeridiem)),
    end: describeTime(end),
  });
}

export function describeWhen(event: CalendarEvent) {
  return event.start.hasSame(event.end, "day")
    ? `${describeDay(event.start)}, ${describeTimeRange(event.start, event.end)}`
    : t("a11y.range", {
        start: `${describeDay(event.start)} ${describeTime(event.start)}`,
        end: `${describeDay(event.end)} ${describeTime(event.end)}`,
      });
}

export function describeEvent(event: CalendarEvent, selected: boolean) {
  const when = describeWhen(event);

  const states = [
    event.isTask &&
      (event.completed ? t("a11y.taskCompleted") : t("a11y.taskNotCompleted")),
    (event.repeat || event._parent) && t("a11y.repeating"),
    event._continued && t("a11y.continued"),
    selected && t("a11y.selected"),
  ].filter(Boolean);

  return [event.title, when, ...states].join(", ");
}

export function describeSlot(
  date: DateTime,
  minutes: number,
  isToday: boolean,
  titles: string[],
) {
  return [
    describeTime(date.startOf("day").plus({ minutes })),
    describeFullDay(date) + (isToday ? `, ${t("a11y.today")}` : ""),
    titles.length > 0 &&
      t("a11y.eventCount", { count: titles.length, titles: titles.join(", ") }),
  ]
    .filter(Boolean)
    .join(", ");
}
