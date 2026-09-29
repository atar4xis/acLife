import type { DateTime } from "luxon";
import type { CalendarEvent } from "@/types/calendar/Event";

export const describeDay = (date: DateTime) => date.toFormat("cccc d LLLL");

export const describeFullDay = (date: DateTime) =>
  date.toFormat("cccc d LLLL yyyy");

const describeTime = (date: DateTime) => date.toFormat("h:mm a");

export function describeTimeRange(start: DateTime, end: DateTime) {
  const sameMeridiem = start.toFormat("a") === end.toFormat("a");
  return `${start.toFormat(sameMeridiem ? "h:mm" : "h:mm a")} to ${describeTime(end)}`;
}

export function describeEvent(event: CalendarEvent, selected: boolean) {
  const sameDay = event.start.hasSame(event.end, "day");
  const when = sameDay
    ? `${describeDay(event.start)}, ${describeTimeRange(event.start, event.end)}`
    : `${describeDay(event.start)} ${describeTime(event.start)} to ${describeDay(event.end)} ${describeTime(event.end)}`;

  const states = [
    event.isTask &&
      (event.completed ? "task, completed" : "task, not completed"),
    (event.repeat || event._parent) && "repeating",
    event._continued && "continued from previous day",
    selected && "selected",
  ].filter(Boolean);

  return [event.title, when, ...states].join(", ");
}
