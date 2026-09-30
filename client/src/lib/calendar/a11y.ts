import type { DateTime } from "luxon";
import type { CalendarEvent } from "@/types/calendar/Event";

const describeDay = (date: DateTime) => date.toFormat("cccc d LLLL");

export const describeFullDay = (date: DateTime) =>
  date.toFormat("cccc d LLLL yyyy");

const timeFormat = (date: DateTime, withMeridiem = true) =>
  (date.minute === 0 ? "h" : "h:mm") + (withMeridiem ? " a" : "");

const describeTime = (date: DateTime) => date.toFormat(timeFormat(date));

function describeTimeRange(start: DateTime, end: DateTime) {
  const sameMeridiem = start.toFormat("a") === end.toFormat("a");
  return `${start.toFormat(timeFormat(start, !sameMeridiem))} to ${describeTime(end)}`;
}

export function describeWhen(event: CalendarEvent) {
  return event.start.hasSame(event.end, "day")
    ? `${describeDay(event.start)}, ${describeTimeRange(event.start, event.end)}`
    : `${describeDay(event.start)} ${describeTime(event.start)} to ${describeDay(event.end)} ${describeTime(event.end)}`;
}

export function describeEvent(event: CalendarEvent, selected: boolean) {
  const when = describeWhen(event);

  const states = [
    event.isTask &&
      (event.completed ? "task, completed" : "task, not completed"),
    (event.repeat || event._parent) && "repeating",
    event._continued && "continued from previous day",
    selected && "selected",
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
    describeFullDay(date) + (isToday ? ", today" : ""),
    titles.length > 0 &&
      `${titles.length} ${titles.length === 1 ? "event" : "events"}: ${titles.join(", ")}`,
  ]
    .filter(Boolean)
    .join(", ");
}
