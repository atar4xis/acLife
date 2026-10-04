import type { DateTime } from "luxon";
import type { CalendarEvent } from "@/types/calendar/Event";
import { clamp } from "@/lib/utils";
import { eventKey } from "./event";

export type GridFocus = {
  day: number;
  minutes: number;
  eventKey: string | null;
};

export type MoveStep = {
  type: "move" | "resize_start" | "resize_end";
  days: number;
  minutes: number;
};

type FocusMove = { day: number; minutes: number; dayShift: -1 | 0 | 1 };

export const MINUTES_PER_DAY = 24 * 60;

export const ALL_DAY_SLOT = -1;

export const lastSlot = (snapMins: number) =>
  Math.floor((MINUTES_PER_DAY - 1) / snapMins) * snapMins;

export const clampSlot = (minutes: number, snapMins: number) =>
  clamp(Math.floor(minutes / snapMins) * snapMins, 0, lastSlot(snapMins));

export const slotWithinDay = (
  time: DateTime,
  day: DateTime,
  snapMins: number,
) => clampSlot(time.diff(day.startOf("day"), "minutes").minutes, snapMins);

const mirrorKey = (key: string, rtl?: boolean) =>
  !rtl
    ? key
    : key === "ArrowLeft"
      ? "ArrowRight"
      : key === "ArrowRight"
        ? "ArrowLeft"
        : key;

export function moveFocus(
  from: { day: number; minutes: number },
  rawKey: string,
  {
    snapMins,
    dayCount,
    rtl,
    allDayLane,
  }: {
    snapMins: number;
    dayCount: number;
    rtl?: boolean;
    allDayLane?: boolean;
  },
): FocusMove | null {
  const key = mirrorKey(rawKey, rtl);
  const { day, minutes } = from;
  const vertical = (m: number): FocusMove => ({
    day,
    minutes: m < 0 && allDayLane ? ALL_DAY_SLOT : clampSlot(m, snapMins),
    dayShift: 0,
  });
  const slot = Math.max(minutes, 0);

  switch (key) {
    case "ArrowUp":
      return vertical(minutes < 0 ? -1 : minutes - snapMins);
    case "ArrowDown":
      return vertical(minutes < 0 ? 0 : minutes + snapMins);
    case "PageUp":
      return vertical(slot - 60);
    case "PageDown":
      return vertical(slot + 60);
    case "Home":
      return vertical(0);
    case "End":
      return vertical(lastSlot(snapMins));
    case "ArrowLeft":
      return day > 0
        ? { day: day - 1, minutes, dayShift: 0 }
        : { day: dayCount - 1, minutes, dayShift: -1 };
    case "ArrowRight":
      return day < dayCount - 1
        ? { day: day + 1, minutes, dayShift: 0 }
        : { day: 0, minutes, dayShift: 1 };
    default:
      return null;
  }
}

export function moveStepForKey(
  e: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">,
  snapMins: number,
  rtl?: boolean,
): MoveStep | null {
  const key = mirrorKey(e.key, rtl);
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
  const vertical = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;

  if (vertical) {
    const minutes = vertical * snapMins;
    if (e.shiftKey && e.ctrlKey && !e.altKey && !e.metaKey)
      return { type: "resize_start", days: 0, minutes };
    if (!plain) return null;
    return { type: e.shiftKey ? "resize_end" : "move", days: 0, minutes };
  }

  if (!plain || e.shiftKey) return null;

  switch (key) {
    case "PageUp":
      return { type: "move", days: 0, minutes: -60 };
    case "PageDown":
      return { type: "move", days: 0, minutes: 60 };
    case "ArrowLeft":
      return { type: "move", days: -1, minutes: 0 };
    case "ArrowRight":
      return { type: "move", days: 1, minutes: 0 };
    default:
      return null;
  }
}

export function eventsAtSlot(
  events: CalendarEvent[] | undefined,
  date: DateTime,
  minutes: number,
  snapMins: number,
) {
  const start = date.startOf("day").plus({ minutes });
  const end = start.plus({ minutes: snapMins });

  return (events ?? [])
    .filter((e) =>
      minutes < 0 ? e.allDay : !e.allDay && e.start < end && e.end > start,
    )
    .toSorted(
      (a, b) =>
        a.start.toMillis() - b.start.toMillis() ||
        eventKey(a).localeCompare(eventKey(b)),
    );
}

export function adjacentEvent(
  days: { date: DateTime; events: CalendarEvent[] | undefined }[],
  from: GridFocus,
  direction: 1 | -1,
  snapMins: number,
) {
  const entries = days
    .flatMap(({ date, events }, day) =>
      (events ?? []).map((event) => {
        const dayStart = date.startOf("day");
        return {
          day,
          key: eventKey(event),
          dayStart,
          allDay: event.allDay,
          startMs: event.allDay
            ? dayStart.toMillis() + ALL_DAY_SLOT * 60000
            : Math.max(event.start.toMillis(), dayStart.toMillis()),
        };
      }),
    )
    .toSorted((a, b) => a.startMs - b.startMs || a.key.localeCompare(b.key));

  const at = from.eventKey
    ? entries.findIndex((e) => e.day === from.day && e.key === from.eventKey)
    : -1;
  const fromMs = days[from.day].date
    .startOf("day")
    .plus({ minutes: from.minutes })
    .toMillis();

  const target =
    at >= 0
      ? entries[at + direction]
      : direction > 0
        ? entries.find((e) => e.startMs > fromMs)
        : entries.findLast((e) => e.startMs < fromMs);
  if (!target) return null;

  return {
    day: target.day,
    minutes: target.allDay
      ? ALL_DAY_SLOT
      : clampSlot(
          (target.startMs - target.dayStart.toMillis()) / 60000,
          snapMins,
        ),
    eventKey: target.key,
  };
}

export function createGridFocusStore() {
  let focus: GridFocus | null = null;
  let keyboardMode = false;
  let spoken: { id: number; day: number; text: string } | null = null;
  let spokenCount = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  return {
    getFocus: () => focus,
    setFocus(next: GridFocus | null) {
      focus = next;
      notify();
    },
    getKeyboardMode: () => keyboardMode,
    setKeyboardMode(on: boolean) {
      if (on === keyboardMode) return;
      keyboardMode = on;
      notify();
    },
    getSpoken: () => spoken,
    setSpoken(day: number, text: string) {
      spoken = { id: ++spokenCount, day, text };
      notify();
    },
    clearSpoken() {
      if (!spoken) return;
      spoken = null;
      notify();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type GridFocusStore = ReturnType<typeof createGridFocusStore>;

export const slotDomId = (day: number, minutes: number) =>
  `calendar-slot-${day}-${minutes}`;

export const eventDomId = (event: CalendarEvent, day: number) =>
  `calendar-event-${eventKey(event)}-${day}`;
