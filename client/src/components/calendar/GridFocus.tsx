import {
  useDayFocus,
  useDaySpoken,
  useKeyboardMode,
  useSpokenActive,
} from "@/hooks/useGridFocus";
import { describeSlot } from "@/lib/calendar/a11y";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/types/calendar/Event";
import {
  eventsAtSlot,
  slotDomId,
  type GridFocusStore,
} from "@/lib/calendar/gridFocus";
import type { DateTime } from "luxon";
import { memo, useLayoutEffect, useRef } from "react";

const MIN_HEIGHT = 20;

const useActiveDescendant = (id: string | null) => {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = ref.current?.closest('[role="grid"]');
    if (!id || !grid) return;

    grid.setAttribute("aria-activedescendant", id);
    return () => {
      if (grid.getAttribute("aria-activedescendant") === id)
        grid.removeAttribute("aria-activedescendant");
    };
  }, [id]);

  return ref;
};

export const SlotIndicator = memo(function SlotIndicator({
  store,
  day,
  date,
  isToday,
  events,
  hourHeight,
  snapMins,
  allDay,
}: {
  store: GridFocusStore;
  day: number;
  date: DateTime;
  isToday: boolean;
  events: CalendarEvent[];
  hourHeight: number;
  snapMins: number;
  allDay?: boolean;
}) {
  const focus = useDayFocus(store, day);
  const keyboardMode = useKeyboardMode(store);
  const id = focus && !focus.eventKey ? slotDomId(day, focus.minutes) : null;
  const spokenActive = useSpokenActive(store);
  const ref = useActiveDescendant(keyboardMode && !spokenActive ? id : null);

  const inStrip = !!focus && focus.minutes < 0;
  if (!focus || !id || inStrip !== !!allDay) return null;

  return (
    <div
      key={id}
      id={id}
      ref={ref}
      role="button"
      tabIndex={-1}
      aria-hidden={!keyboardMode || undefined}
      aria-label={describeSlot(
        date,
        focus.minutes,
        isToday,
        eventsAtSlot(events, date, focus.minutes, snapMins).map((e) => e.title),
      )}
      className={cn(
        "pointer-events-none absolute left-0 right-0 z-20 border-2 border-foreground bg-foreground/15 shadow-[0_0_0_1px_var(--background)] opacity-0 group-data-keyboard-mode/grid:opacity-100",
        allDay && "inset-y-0",
      )}
      style={
        allDay
          ? undefined
          : {
              top: (focus.minutes / 60) * hourHeight,
              height: Math.max(MIN_HEIGHT, (snapMins / 60) * hourHeight),
            }
      }
    />
  );
});

export const SpokenMessage = memo(function SpokenMessage({
  store,
  day,
}: {
  store: GridFocusStore;
  day: number;
}) {
  const move = useDaySpoken(store, day);
  const id = move ? `calendar-spoken-${move.id}` : null;
  const ref = useActiveDescendant(id);

  if (!move || !id) return null;

  return (
    <div
      key={id}
      id={id}
      ref={ref}
      tabIndex={-1}
      aria-label={move.text}
      className="sr-only"
    />
  );
});
