import type { DateTime, Duration } from "luxon";
import { fmt, t as translate } from "@/i18n";
import { describeAllDayRange } from "@/lib/calendar/date";
import { eventKey, MAX_EVENT_DURATION_MINUTES } from "@/lib/calendar/event";
import type { GridSelectionRef } from "@/types/calendar/Cell";
import type { CalendarEvent, EventDragRef } from "@/types/calendar/Event";

export const SELECT_DRAG_THRESHOLD = 4;
export const AUTO_SCROLL_ZONE = 24;
export const AUTO_SCROLL_SPEED = 20;

export const resolveSelection = (
  eventMap: Map<string, CalendarEvent[]> | null,
  selected: Map<string, CalendarEvent>,
  excludeKey: string,
) => {
  const live = new Map<string, CalendarEvent>();

  for (const dayEvents of eventMap?.values() ?? []) {
    for (const ev of dayEvents) {
      if (ev._continued) continue;

      const key = eventKey(ev);
      if (selected.has(key) && !live.has(key)) live.set(key, ev);
    }
  }

  const resolved: CalendarEvent[] = [];
  for (const [key, stored] of selected) {
    if (key === excludeKey) continue;
    resolved.push(live.get(key) ?? stored);
  }

  return resolved;
};

export const getBoxedKeys = (state: GridSelectionRef) => {
  const left = Math.min(state.x0, state.x1);
  const right = Math.max(state.x0, state.x1);
  const top = Math.min(state.y0, state.y1);
  const bottom = Math.max(state.y0, state.y1);

  const keys = new Set<string>();

  for (const rect of state.rects) {
    if (
      rect.left <= right &&
      rect.right >= left &&
      rect.top <= bottom &&
      rect.bottom >= top
    ) {
      keys.add(rect.key);
    }
  }

  return keys;
};

export const getEventsByKey = (
  eventMap: Map<string, CalendarEvent[]> | null,
  keys: Set<string>,
) => {
  const found: CalendarEvent[] = [];
  const seen = new Set<string>();

  for (const dayEvents of eventMap?.values() ?? []) {
    for (const ev of dayEvents) {
      const key = eventKey(ev);
      if (ev._continued || seen.has(key) || !keys.has(key)) continue;

      seen.add(key);
      found.push(ev);
    }
  }

  return found;
};

export const getDraggedTimes = (
  type: "move" | "resize_start" | "resize_end" | "new",
  originalStart: DateTime,
  originalEnd: DateTime,
  dayDelta: number,
  deltaMinutes: number,
  snapMins: number,
) => {
  let newStart = originalStart;
  let newEnd = originalEnd;

  if (type === "move") {
    newStart = originalStart.plus({ days: dayDelta, minutes: deltaMinutes });
    newEnd = originalEnd.plus({ days: dayDelta, minutes: deltaMinutes });
  } else if (type === "resize_start") {
    newStart = originalStart.plus({ days: dayDelta, minutes: deltaMinutes });
    if (newStart >= newEnd) {
      newStart = newEnd.minus({ minutes: snapMins });
    }
    if (newEnd.diff(newStart).as("minutes") > MAX_EVENT_DURATION_MINUTES) {
      newStart = newEnd.minus({ minutes: MAX_EVENT_DURATION_MINUTES });
    }
  } else if (type === "resize_end") {
    newEnd = originalEnd.plus({ days: dayDelta, minutes: deltaMinutes });
    if (newEnd <= newStart) {
      newEnd = newStart.plus({ minutes: snapMins });
    }
    if (newEnd.diff(newStart).as("minutes") > MAX_EVENT_DURATION_MINUTES) {
      newEnd = newStart.plus({ minutes: MAX_EVENT_DURATION_MINUTES });
    }
  } else if (type === "new") {
    const anchor = originalStart;
    const pointerTime = anchor.plus({ days: dayDelta, minutes: deltaMinutes });

    if (pointerTime >= anchor) {
      newStart = anchor;
      newEnd = pointerTime;
      if (newEnd <= newStart) {
        newEnd = newStart.plus({ minutes: snapMins });
      }
      if (newEnd.diff(newStart).as("minutes") > MAX_EVENT_DURATION_MINUTES) {
        newEnd = newStart.plus({ minutes: MAX_EVENT_DURATION_MINUTES });
      }
    } else {
      newStart = pointerTime;
      newEnd = anchor;
      if (newStart >= newEnd) {
        newStart = newEnd.minus({ minutes: snapMins });
      }
      if (newEnd.diff(newStart).as("minutes") > MAX_EVENT_DURATION_MINUTES) {
        newStart = newEnd.minus({ minutes: MAX_EVENT_DURATION_MINUTES });
      }
    }
  }

  return { newStart, newEnd };
};

// pointerId stand-in for drags started from the keyboard
export const KEYBOARD_DRAG_ID = -1;

export const describeDragLabel = (
  { start, end, allDay }: Pick<CalendarEvent, "start" | "end" | "allDay">,
  extraCount = 0,
) => {
  let label: string;
  if (allDay) {
    label = [describeAllDayRange(start, end), translate("editor.allDay")]
      .filter(Boolean)
      .join("\n");
  } else {
    const diff = end.diff(start).shiftTo("hours", "minutes");
    const hours = Math.floor(diff.hours);
    const minutes = Math.round(diff.minutes);
    const durText = [];
    if (hours > 0) durText.push(translate("calendar.hours", { count: hours }));
    if (minutes > 0)
      durText.push(translate("calendar.minutes", { count: minutes }));
    label = `${start.toFormat(fmt("time"))} - ${end.toFormat(fmt("time"))}\n${durText.join(" ")}`;
  }
  if (extraCount) {
    label += `\n${translate("calendar.eventsCount", { count: extraCount + 1 })}`;
  }
  return label;
};

export const isAtOriginal = (
  ev: CalendarEvent,
  originalStart: DateTime,
  originalEnd: DateTime,
) =>
  ev.start.toMillis() === originalStart.toMillis() &&
  ev.end.toMillis() === originalEnd.toMillis();

export const applyTimes = (
  target: { start: DateTime; end: DateTime },
  times: { newStart: DateTime; newEnd: DateTime },
) => {
  if (
    target.start.toMillis() === times.newStart.toMillis() &&
    target.end.toMillis() === times.newEnd.toMillis()
  )
    return false;

  target.start = times.newStart;
  target.end = times.newEnd;
  return true;
};

export const toAllDay = (
  event: CalendarEvent,
  day: DateTime,
  duration?: Duration,
) => {
  const flipped = !event.allDay;
  event.allDay = true;
  return (
    applyTimes(event, {
      newStart: day.startOf("day"),
      newEnd: duration ? day.startOf("day").plus(duration) : day.endOf("day"),
    }) || flipped
  );
};

export const toTimed = (
  event: CalendarEvent,
  start: DateTime,
  duration: Duration | { minutes: number },
) => {
  const flipped = !!event.allDay;
  event.allDay = undefined;
  return (
    applyTimes(event, { newStart: start, newEnd: start.plus(duration) }) ||
    flipped
  );
};

export const applyDragDelta = (
  state: NonNullable<EventDragRef>,
  dayDelta: number,
  deltaMinutes: number,
  snapMins: number,
  from: "original" | "current" = "original",
) => {
  const timesFor = (
    target: { start: DateTime; end: DateTime },
    original: { originalStart: DateTime; originalEnd: DateTime },
  ) =>
    getDraggedTimes(
      state.type,
      from === "original" ? original.originalStart : target.start,
      from === "original" ? original.originalEnd : target.end,
      dayDelta,
      deltaMinutes,
      snapMins,
    );

  const primary = timesFor(state.event, state);
  let changed = applyTimes(state.event, primary);

  for (const entry of state.selection ?? []) {
    if (applyTimes(entry.event, timesFor(entry.event, entry))) changed = true;
  }

  return { ...primary, changed };
};

export const applyDragWithResize = (
  state: NonNullable<EventDragRef>,
  dayDelta: number,
  deltaMinutes: number,
  snapMins: number,
) => {
  state.dayDelta = dayDelta;
  state.deltaMinutes = deltaMinutes;
  const dragged = applyDragDelta(state, dayDelta, deltaMinutes, snapMins);
  const resize = state.resize;
  if (!resize || state.selection?.length) return dragged;

  let { newStart, newEnd } = dragged;
  if (resize.start)
    newStart = getDraggedTimes(
      "resize_start",
      newStart,
      newEnd,
      0,
      resize.start,
      snapMins,
    ).newStart;
  if (resize.end)
    newEnd = getDraggedTimes(
      "resize_end",
      newStart,
      newEnd,
      0,
      resize.end,
      snapMins,
    ).newEnd;

  return {
    newStart,
    newEnd,
    changed: applyTimes(state.event, { newStart, newEnd }) || dragged.changed,
  };
};
