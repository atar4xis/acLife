import {
  useRef,
  useState,
  Fragment,
  useMemo,
  useEffect,
  useCallback,
  useReducer,
} from "react";
import { DateTime } from "luxon";
import { ArrowLeft, ArrowRight, SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";

import { cn } from "@/lib/utils";
import type { CalendarProps, WithChildren } from "@/types/Props";
import type {
  CalendarEvent,
  EventChange,
  EventDragRef,
  EventStyle,
} from "@/types/calendar/Event";
import EventBlock from "./EventBlock";
import DragOverlay from "./DragOverlay";
import { calendarReducer } from "@/reducers/calendarReducer";
import { useCalendar } from "@/context/CalendarContext";
import {
  getDay,
  getWeekDays,
  yToMinutes,
  snapMinutes,
  isSameDate,
  getDateRangeString,
} from "@/lib/calendar/date";
import { getDayRects } from "@/lib/calendar/dom";
import { getDayEventStyles } from "@/lib/calendar/event";
import { useUser } from "@/context/UserContext";

/* -------------------------------------------------------------------------- */

type CellProps = React.ComponentProps<"div"> & WithChildren;

function HeaderCell({ children, className }: CellProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-5 border-b border-r flex items-center justify-center bg-background",
        className,
      )}
    >
      {children}
    </div>
  );
}

function GridCell({
  children,
  className,
  day,
  onPointerDown,
}: CellProps & { day: number }) {
  return (
    <div
      className={cn("relative border-b border-r", className)}
      data-day-index={day}
      onPointerDown={onPointerDown}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const GRID_HEADER_HEIGHT = 48;

// TODO: make these configurable
const DEFAULT_EVENT_NAME = "new event";
const DEFAULT_EVENT_DURATION = 60;
const SNAP_MINS = 5;

const GRID_CONFIG = {
  day: {
    cols: "4rem 1fr",
    rows: (h: number) => `48px repeat(24, ${h}px)`,
  },
  week: {
    cols: "4rem repeat(7, 1fr)",
    rows: (h: number) => `48px repeat(24, ${h}px)`,
  },
} as const;

const HOURS = Array.from(
  { length: 24 },
  (_, i) => `${((i + 11) % 12) + 1} ${i < 12 ? "AM" : "PM"}`,
);

/* -------------------------------------------------------------------------- */

// TODO: clean this up, separate into smaller components and hooks
export default function AppCalendar({
  events,
  mode,
  setMode,
  saveEvents,
}: CalendarProps) {
  const { currentDate, setCurrentDate } = useCalendar();
  const [calendarEvents, dispatch] = useReducer(calendarReducer, events);
  const calendarEventsRef = useRef<CalendarEvent[]>(calendarEvents);
  const [isDragging, setIsDragging] = useState(false);
  const [hourHeight, setHourHeight] = useState(60);
  const [now, setNow] = useState(DateTime.now());
  const changesMapRef = useRef<Map<string, EventChange>>(new Map());
  const { user } = useUser();

  const { cols, rows } = GRID_CONFIG[mode as keyof typeof GRID_CONFIG];

  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<EventDragRef>(null);
  const hourHeightRef = useRef(hourHeight);

  const visibleDays =
    {
      day: getDay(currentDate),
      week: getWeekDays(currentDate),
    }[mode] ?? [];

  const move = (steps: number) => {
    const unit = mode === "day" ? "days" : mode === "week" ? "weeks" : "months";
    setCurrentDate(currentDate.plus({ [unit]: steps }));
  };

  const getNowY = () => {
    const minutes = now.hour * 60 + now.minute;
    return (minutes / 60) * hourHeight;
  };

  const updateChange = (change: EventChange) => {
    changesMapRef.current.set(change.event?.id ?? change.id!, change);
  };

  const saveIfChanged = () => {
    if (changesMapRef.current.size > 0) {
      saveEvents(Array.from(changesMapRef.current.values()), () => null);
      changesMapRef.current.clear(); // reset after save
    }
  };

  /* -------------------------------------------------------------------------- */

  const onCellPointerDown = (e: React.PointerEvent, dayIndex: number) => {
    if (e.button !== 0) return; // left click only

    const container = gridRef.current;
    if (!container) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = container.getBoundingClientRect();
    const startY = e.clientY + container.scrollTop;

    const startMinutes = yToMinutes(
      startY - rect.top - GRID_HEADER_HEIGHT,
      hourHeight,
    );

    const start = visibleDays[dayIndex].date.plus({
      minutes: snapMinutes(startMinutes, SNAP_MINS),
    });
    const end = start.plus({ minutes: DEFAULT_EVENT_DURATION });

    const newEvent = {
      id: crypto.randomUUID(),
      title: DEFAULT_EVENT_NAME,
      start,
      end,
      timestamp: Date.now(),
    } as CalendarEvent;

    setIsDragging(true);

    dispatch({
      type: "add",
      event: newEvent,
    });

    updateChange({
      type: "added",
      event: newEvent,
    });

    dragRef.current = {
      pointerId: e.pointerId,
      type: "resize_end",
      startY,
      x: e.clientX,
      y: e.clientY,
      event: newEvent,
      originalDay: dayIndex,
      originalStart: start,
      originalEnd: start,
      label: "new event",
      dayRects: getDayRects(),
    };

    window.addEventListener("pointermove", onGlobalPointerMove);
    window.addEventListener("pointerup", onGlobalPointerUp);
  };

  const onGlobalPointerMove = useCallback(
    (e: PointerEvent) => {
      const state = dragRef.current;
      if (!state || e.pointerId !== state.pointerId) return;

      const container = gridRef.current;
      if (!container) return;

      // find the day the pointer is in
      const targetRect = state.dayRects.find(
        (d) => e.clientX >= d.rect.left && e.clientX <= d.rect.right,
      );
      if (!targetRect) return;

      const dayIndex = targetRect.day;
      const dayDate = visibleDays[dayIndex]?.date;
      if (!dayDate) return;

      // calculate minutes based on pointer Y within the grid
      const deltaMinutes = snapMinutes(
        yToMinutes(e.clientY + container.scrollTop - state.startY, hourHeight),
        SNAP_MINS,
      );

      const dayDelta = dayDate
        .startOf("day")
        .diff(state.originalStart.startOf("day"), "days").days;

      let newStart = state.originalStart;
      let newEnd = state.originalEnd;

      if (state.type === "move") {
        // if moving, change both start and end
        newStart = state.originalStart.plus({
          days: dayDelta,
          minutes: deltaMinutes,
        });
        newEnd = state.originalEnd.plus({
          days: dayDelta,
          minutes: deltaMinutes,
        });
      } else if (state.type === "resize_start") {
        // if resizing from the start, change the start only
        newStart = state.originalStart.plus({
          days: dayDelta,
          minutes: deltaMinutes,
        });
        if (newStart >= newEnd) {
          newStart = newEnd.minus({ minutes: SNAP_MINS });
        }
      } else if (state.type === "resize_end") {
        // if resizing from the end, change the end only
        newEnd = state.originalEnd.plus({
          days: dayDelta,
          minutes: deltaMinutes,
        });
        if (newEnd <= newStart) {
          newEnd = newStart.plus({ minutes: SNAP_MINS });
        }
      }

      // when dragging, label tells the new start/end times and follows the pointer
      state.label = `${newStart.toFormat("t")} - ${newEnd.toFormat("t")}`;
      state.x = e.clientX;
      state.y = e.clientY;

      const newEvent = {
        ...state.event,
        start: newStart,
        end: newEnd,
        timestamp: Date.now(),
      };

      // update the edited event in state
      if (
        !state.event.start.equals(newStart) ||
        !state.event.end.equals(newEnd)
      ) {
        dispatch({
          type: "update",
          id: state.event.id,
          data: {
            start: newStart,
            end: newEnd,
          },
        });

        updateChange({
          type: "updated",
          event: newEvent,
        });
      }
    },
    [visibleDays],
  );

  const onGlobalPointerUp = useCallback(
    (e: PointerEvent) => {
      // make sure the same pointer was released, then reset drag state and remove listeners
      if (dragRef.current?.pointerId === e.pointerId) {
        dragRef.current = null;
        setIsDragging(false);

        // TODO: optimize maybe
        if (user?.type === "online") saveIfChanged();
        else saveEvents(calendarEventsRef.current, () => {}); // save all events for offline users

        window.removeEventListener("pointermove", onGlobalPointerMove);
        window.removeEventListener("pointerup", onGlobalPointerUp);
      }
    },
    [user, onGlobalPointerMove],
  );

  const onPointerDown = useCallback(
    (
      e: React.PointerEvent,
      type: "move" | "resize_start" | "resize_end",
      event: CalendarEvent,
      dayIndex: number,
    ) => {
      const container = gridRef.current;
      if (!container) return;

      e.stopPropagation();
      setIsDragging(true);

      dragRef.current = {
        pointerId: e.pointerId,
        type,
        startY: e.clientY + container.scrollTop,
        x: e.clientX,
        y: e.clientY,
        event: event,
        originalDay: dayIndex,
        originalStart: event.start,
        originalEnd: event.end,
        label: "",
        dayRects: getDayRects(),
      };

      window.addEventListener("pointermove", onGlobalPointerMove);
      window.addEventListener("pointerup", onGlobalPointerUp);
    },
    [onGlobalPointerMove, onGlobalPointerUp],
  );

  const onEventEdit = (event: CalendarEvent) => {
    dispatch({
      type: "update",
      id: event.id,
      data: event,
    });

    updateChange({
      id: event.id,
      type: "updated",
      event,
    });

    saveIfChanged();
  };

  /* -------------------------------------------------------------------------- */

  // sync ref with state for zoom calculations
  useEffect(() => {
    hourHeightRef.current = hourHeight;
  }, [hourHeight]);

  // and for calendar events
  useEffect(() => {
    calendarEventsRef.current = calendarEvents;
  }, [calendarEvents]);

  // zoom in with ctrl + mouse wheel
  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      const delta = e.deltaY > 0 ? -5 : 5;
      const newHeight = Math.max(
        20,
        Math.min(200, hourHeightRef.current + delta),
      );

      const rect = container.getBoundingClientRect();
      const mouseY = e.clientY - rect.top + container.scrollTop;
      const zoomFactor = newHeight / hourHeightRef.current;

      container.scrollTop = mouseY * zoomFactor - (e.clientY - rect.top);

      hourHeightRef.current = newHeight;
      setHourHeight(newHeight);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // update now every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(DateTime.now());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // reset events when the defaults change
  useEffect(() => {
    dispatch({ type: "set", events });
  }, [events]);

  /* -------------------------------------------------------------------------- */

  // build map of (day: events) for optimal fetching
  const eventMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    const visibleDates = new Set(visibleDays.map((d) => d.date.toISODate()));

    for (const e of calendarEvents) {
      let day = e.start.startOf("day");
      const lastDay = e.end.startOf("day");

      while (day.toMillis() <= lastDay.toMillis()) {
        const key = day.toISODate()!;
        if (!visibleDates.has(key)) {
          day = day.plus({ days: 1 });
          continue;
        }

        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(e);
        day = day.plus({ days: 1 });
      }
    }

    return map;
  }, [calendarEvents, visibleDays]);

  // build map of event styles
  const stylesMap = useMemo(() => {
    const map = new Map<string, Record<string, EventStyle>>();

    visibleDays.forEach((d) => {
      const dayKey = d.date.toISODate()!;
      const dayEvents = eventMap.get(dayKey) || [];
      map.set(dayKey, getDayEventStyles(dayEvents, d.date, hourHeight));
    });

    return map;
  }, [visibleDays, eventMap, hourHeight]);

  // headers in day/week view, one for every visibleDay
  const dayWeekHeaders = visibleDays.map((d) => (
    <HeaderCell
      key={d.label}
      className={`select-none ${isSameDate(d.date, DateTime.now()) ? "bg-card font-bold" : ""}`}
    >
      {d.label}
    </HeaderCell>
  ));

  // grid in day/week view
  const timeGrid = HOURS.map((label, hour) => (
    <Fragment key={label}>
      <div
        className={`select-none sticky left-0 z-5 border-r border-b flex text-sm items-center justify-center ${hour == DateTime.now().hour ? "bg-card font-bold" : "bg-background"}`}
      >
        {label}
      </div>

      {visibleDays.map((d, dayIndex) => {
        const dayEvents = eventMap.get(d.date.toISODate()!) || [];
        const styles = stylesMap.get(d.date.toISODate()!) || {};

        return (
          <GridCell
            key={`${d.label}-${hour}`}
            day={dayIndex}
            onPointerDown={(e) => onCellPointerDown(e, dayIndex)}
          >
            {hour === 0 && (
              <div className="relative h-full">
                <div style={{ height: hourHeight * 24 }} />

                {/* current time indicator line */}
                {isSameDate(d.date, now) && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-15 shadow-xl bg-white
                    before:absolute before:-left-1 before:top-1/2
                    before:h-2 before:w-2 before:-translate-y-1/2
                    before:rounded-full before:bg-white"
                    style={{
                      top: getNowY(),
                      height: 2,
                    }}
                  />
                )}

                {/* today's events */}
                {dayEvents.map((event) => (
                  <EventBlock
                    key={event.id}
                    event={event}
                    day={dayIndex}
                    style={styles[event.id]}
                    onPointerDown={onPointerDown}
                    onEventEdit={onEventEdit}
                    onEventDelete={() => {
                      dispatch({
                        type: "delete",
                        id: event.id,
                      });

                      updateChange({
                        id: event.id,
                        type: "deleted",
                      });

                      saveIfChanged();
                    }}
                  />
                ))}
              </div>
            )}
          </GridCell>
        );
      })}
    </Fragment>
  ));

  return (
    <main className="flex h-screen w-full flex-col">
      <nav className="flex items-center justify-between border-b p-3">
        <SidebarTrigger className="md:hidden" />

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setCurrentDate(DateTime.now())}
          >
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => move(-1)}>
            <ArrowLeft />
          </Button>
          <Button variant="outline" size="icon" onClick={() => move(1)}>
            <ArrowRight />
          </Button>
          <h2 className="ml-2 text-xl">
            {getDateRangeString(mode, currentDate)}
          </h2>
        </div>

        <Select value={mode} onValueChange={setMode}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Day</SelectItem>
            <SelectItem value="week">Week</SelectItem>
          </SelectContent>
        </Select>

        {/* TODO: implement search function */}
        <div className="flex items-center gap-2">
          <SearchIcon />
          <Input className="hidden md:block" placeholder="Search events..." />
        </div>
      </nav>

      <div className="flex-1 overflow-hidden">
        <div
          ref={gridRef}
          className="grid h-full overflow-auto"
          style={{
            gridTemplateColumns: cols,
            gridTemplateRows: rows(hourHeight),
          }}
        >
          <div className="sticky left-0 top-0 z-5 border-b border-r bg-background" />

          {dayWeekHeaders}
          {timeGrid}

          {isDragging && <DragOverlay dragRef={dragRef} />}
        </div>
      </div>
    </main>
  );
}
