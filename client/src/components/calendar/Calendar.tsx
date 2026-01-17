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
import useTapInteraction from "@/hooks/useTapInteraction";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Label } from "../ui/label";
import { toast } from "sonner";

/* -------------------------------------------------------------------------- */

type CellProps = React.ComponentProps<"div"> & WithChildren;

function HeaderCell({ children, className }: CellProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-11 border-b border-r flex items-center justify-center bg-background min-w-0",
        className,
      )}
    >
      <span className="truncate w-full text-center">{children}</span>
    </div>
  );
}

function GridCell({
  children,
  className,
  day,
  onCellTap,
  ...handlers
}: CellProps & {
  day: number;
  onCellTap: (e: React.PointerEvent, day: number) => void;
}) {
  const { handlers: tapHandlers } = useTapInteraction({
    onTap: (e) => onCellTap(e, day),
  });

  return (
    <div
      className={cn("relative border-b border-r", className)}
      data-day-index={day}
      {...handlers}
      {...tapHandlers}
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
  const [updateRepeatDialogOpen, setUpdateRepeatDialogOpen] = useState(false);
  const [deleteRepeatDialogOpen, setDeleteRepeatDialogOpen] = useState(false);
  const [repeatOption, setRepeatOption] = useState<string>("this");
  const [now, setNow] = useState(DateTime.now());
  const [_, forceRender] = useState(false);
  const changesMapRef = useRef<Map<string, EventChange>>(new Map());
  const { user } = useUser();

  const { cols, rows } = GRID_CONFIG[mode as keyof typeof GRID_CONFIG];

  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<EventDragRef>(null);
  const hourHeightRef = useRef(hourHeight);

  const toBeDeletedRef = useRef<CalendarEvent | null>(null);

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

  const save = () => {
    if (user?.type === "online") saveIfChanged();
    else saveEvents(calendarEventsRef.current, () => {}); // save all events for offline users
  };

  /* -------------------------------------------------------------------------- */

  const startNewEvent = (e: React.PointerEvent, dayIndex: number) => {
    const container = gridRef.current;
    if (!container) return;

    e.preventDefault();

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

    dispatch({
      type: "add",
      event: newEvent,
    });

    updateChange({
      type: "added",
      event: newEvent,
    });

    if (e.pointerType !== "touch") {
      setIsDragging(true);

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
        moved: false,
      };
    }

    window.addEventListener("pointermove", onGlobalPointerMove);
    window.addEventListener("pointerup", onGlobalPointerUp);
  };

  /* -------------------------------------------------------------------------- */

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

      const dayDelta = dayIndex - state.originalDay;

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

      if (
        state.event.start.toMillis() != newStart.toMillis() ||
        state.event.end.toMillis() != newEnd.toMillis()
      ) {
        state.event.start = newStart;
        state.event.end = newEnd;
        state.moved = true;
        forceRender((prev) => !prev);
      }
    },
    [visibleDays],
  );

  const onGlobalPointerUp = useCallback(
    (e: PointerEvent) => {
      // make sure the same pointer was released, then reset drag state and remove listeners
      if (dragRef.current?.pointerId === e.pointerId) {
        const state = dragRef.current;
        const event = state.event;

        if (!event) return;

        const newEvent = {
          ...event,
          timestamp: Date.now(),
        };

        // update the edited event in state
        if (!event.parent) {
          if (
            newEvent.start.toMillis() !== state.originalStart.toMillis() ||
            newEvent.end.toMillis() !== state.originalEnd.toMillis()
          ) {
            dispatch({
              type: "update",
              id: event.id,
              data: {
                start: newEvent.start,
                end: newEvent.end,
              },
            });

            updateChange({
              type: "updated",
              event: newEvent,
            });
          }

          calendarEventsRef.current = calendarEventsRef.current.map((e) =>
            e.id === event.id ? newEvent : e,
          );

          dragRef.current = null;
          save();
        } else if (dragRef.current.moved) {
          // if the event has a parent, ask what to do
          setUpdateRepeatDialogOpen(true);
        }

        setIsDragging(false);

        window.removeEventListener("pointermove", onGlobalPointerMove);
        window.removeEventListener("pointerup", onGlobalPointerUp);
      }
    },
    [user, onGlobalPointerMove],
  );

  const onEventPointerDown = useCallback(
    (
      e: React.PointerEvent,
      type: "move" | "resize_start" | "resize_end",
      event: CalendarEvent,
      dayIndex: number,
    ) => {
      if (e.pointerType === "touch") {
        e.stopPropagation();
        return;
      }

      if (e.button !== 0) return;

      const container = gridRef.current;
      if (!container) return;

      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);

      dragRef.current = {
        pointerId: e.pointerId,
        type,
        startY: e.clientY + container.scrollTop,
        x: e.clientX,
        y: e.clientY,
        event: { ...event },
        originalDay: dayIndex,
        originalStart: event.start,
        originalEnd: event.end,
        label: "",
        dayRects: getDayRects(),
        moved: false,
      };

      window.addEventListener("pointermove", onGlobalPointerMove);
      window.addEventListener("pointerup", onGlobalPointerUp);
    },
    [onGlobalPointerMove, onGlobalPointerUp],
  );

  const onEventEdit = (event: CalendarEvent) => {
    if (event.parent) {
      if (dragRef.current) {
        dragRef.current.event = event;
      } else {
        toast.error("Failed to edit event.");
      }
      setUpdateRepeatDialogOpen(true);
      return;
    }

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

    calendarEventsRef.current = calendarEventsRef.current.map((e) =>
      e.id === event.id ? event : e,
    );

    save();
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
      if (e.id === dragRef.current?.event.id && dragRef.current.moved) continue;

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

      // repeating event logic
      if (
        e.repeat &&
        (!dragRef.current?.moved || dragRef.current.event.parent !== e.id)
      ) {
        let cursor = e.start;
        const duration = e.end.diff(e.start);

        const repeat = (at: DateTime) => {
          const end = at.plus(duration);
          const key = at.toISODate()!;
          if (!visibleDates.has(key)) return; // don't repeat outside of visible range

          if (!map.has(key)) map.set(key, []);
          map.get(key)!.push({
            ...e,
            id: e.id + "_" + key, // each repetition needs a unique id
            start: at,
            end,
            parent: e.id,
          });
        };

        while (cursor <= visibleDays.at(-1)!.date.endOf("day")) {
          // loop visible days
          const dayIndex = cursor.weekday;

          if (
            cursor.toMillis() !== e.start.toMillis() &&
            (!e.repeat.until || cursor.toMillis() < e.repeat.until) &&
            !e.repeat.except?.includes(dayIndex) &&
            !e.repeat.skip?.includes(cursor.toISODate()!)
          ) {
            repeat(cursor);
          }

          cursor = cursor.plus({
            [e.repeat.unit]: e.repeat.interval,
          });
        }
      }
    }

    if (dragRef.current?.event && dragRef.current.moved) {
      const tempEvent = dragRef.current?.event;
      const key = tempEvent.start.toISODate()!;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tempEvent);
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
            onCellTap={startNewEvent}
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
                    onPointerDown={onEventPointerDown}
                    onEventEdit={onEventEdit}
                    onEventDelete={() => {
                      if (event.parent) {
                        setDeleteRepeatDialogOpen(true);
                        toBeDeletedRef.current = event;
                        return;
                      }

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

        <div className="flex items-center gap-2 hidden md:flex">
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

        <h2 className="flex-1 text-xl ml-6 md:hidden">
          {getDateRangeString(mode, currentDate)}
        </h2>

        <Select value={mode} onValueChange={setMode}>
          <SelectTrigger className="mr-4 md:mr-0">
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
          <Input className="hidden lg:block" placeholder="Search events..." />
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

      <AlertDialog open={updateRepeatDialogOpen}>
        <AlertDialogContent className="w-auto text-center">
          <AlertDialogTitle>Update recurring event</AlertDialogTitle>
          <AlertDialogDescription>
            Which event would you like to update?
          </AlertDialogDescription>
          <RadioGroup
            value={repeatOption}
            onValueChange={setRepeatOption}
            className="mt-3 gap-5"
          >
            <div className="flex gap-3">
              <RadioGroupItem value="this" id="this" />
              <Label htmlFor="this">This event</Label>
            </div>
            <div className="flex gap-3">
              <RadioGroupItem value="future" id="future" />
              <Label htmlFor="future">This and future events</Label>
            </div>
            <div className="flex gap-3">
              <RadioGroupItem value="all" id="all" />
              <Label htmlFor="all">All events</Label>
            </div>
          </RadioGroup>
          <AlertDialogFooter className="!flex-col mt-5">
            <AlertDialogAction
              onClick={() => {
                const event = dragRef.current?.event;
                const parent = calendarEvents.find(
                  (e) => e.id === event?.parent,
                );
                if (!dragRef.current || !event || !parent || !parent.repeat) {
                  toast.error("Event no longer exists.");
                  dragRef.current = null;
                  setUpdateRepeatDialogOpen(false);
                  return;
                }

                switch (repeatOption) {
                  case "this": {
                    // skip current repetition
                    if (!parent.repeat.skip) parent.repeat.skip = [];
                    parent.repeat.skip.push(
                      dragRef.current.originalStart.toISODate()!,
                    );

                    updateChange({
                      type: "updated",
                      event: parent,
                    });

                    dispatch({
                      type: "update",
                      id: parent.id,
                      data: parent,
                    });

                    // clone the event
                    const newEvent = {
                      ...event,
                      id: crypto.randomUUID(),
                      timestamp: Date.now(),
                    } as CalendarEvent;

                    delete newEvent.parent; // detach from parent
                    delete newEvent.repeat; // don't repeat

                    dispatch({
                      type: "add",
                      event: newEvent,
                    });

                    updateChange({
                      type: "added",
                      event: newEvent,
                    });

                    break;
                  }

                  case "future": {
                    // clone the event
                    const newEvent = {
                      ...event,
                      id: crypto.randomUUID(),
                      timestamp: Date.now(),
                      repeat: {
                        interval: parent.repeat.interval,
                        unit: parent.repeat.unit,
                      },
                    } as CalendarEvent;

                    delete newEvent.parent; // detach from parent

                    dispatch({
                      type: "add",
                      event: newEvent,
                    });

                    updateChange({
                      type: "added",
                      event: newEvent,
                    });

                    // end parent's repetition
                    parent.repeat.until = event.start.startOf("day").toMillis();

                    updateChange({
                      type: "updated",
                      event: parent,
                    });

                    dispatch({
                      type: "update",
                      id: parent.id,
                      data: parent,
                    });
                    break;
                  }

                  case "all": {
                    // update the parent
                    const newEvent = {
                      ...event,
                      start: parent.start.set({
                        day:
                          parent.start.day -
                          (dragRef.current.originalStart.day - event.start.day),
                        hour: event.start.hour,
                        minute: event.start.minute,
                      }),
                      end: parent.end.set({
                        day:
                          parent.end.day -
                          (dragRef.current.originalEnd.day - event.end.day),
                        hour: event.end.hour,
                        minute: event.end.minute,
                      }),
                      id: parent.id,
                    };

                    delete newEvent.parent;

                    dispatch({
                      type: "update",
                      id: newEvent.id,
                      data: newEvent,
                    });

                    updateChange({
                      type: "updated",
                      event: newEvent,
                    });
                    break;
                  }
                }

                dragRef.current = null;
                setUpdateRepeatDialogOpen(false);

                save();
              }}
            >
              Update
            </AlertDialogAction>
            <AlertDialogCancel
              onClick={() => {
                dragRef.current = null;
                setUpdateRepeatDialogOpen(false);
              }}
            >
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteRepeatDialogOpen}>
        <AlertDialogContent className="w-auto text-center">
          <AlertDialogTitle>Delete recurring event</AlertDialogTitle>
          <AlertDialogDescription>
            Which event would you like to delete?
          </AlertDialogDescription>
          <RadioGroup
            value={repeatOption}
            onValueChange={setRepeatOption}
            className="mt-3 gap-5"
          >
            <div className="flex gap-3">
              <RadioGroupItem value="this" id="this" />
              <Label htmlFor="this">This event</Label>
            </div>
            <div className="flex gap-3">
              <RadioGroupItem value="future" id="future" />
              <Label htmlFor="future">This and future events</Label>
            </div>
            <div className="flex gap-3">
              <RadioGroupItem value="all" id="all" />
              <Label htmlFor="all">All events</Label>
            </div>
          </RadioGroup>
          <AlertDialogFooter className="!flex-col mt-5">
            <AlertDialogAction
              onClick={() => {
                const event = toBeDeletedRef?.current;
                const parent = calendarEvents.find(
                  (e) => e.id === event?.parent,
                );
                if (
                  !toBeDeletedRef.current ||
                  !event ||
                  !parent ||
                  !parent.repeat
                ) {
                  toast.error("Event no longer exists.");
                  toBeDeletedRef.current = null;
                  setDeleteRepeatDialogOpen(false);
                  return;
                }

                switch (repeatOption) {
                  case "this": {
                    // skip current repetition
                    if (!parent.repeat.skip) parent.repeat.skip = [];
                    parent.repeat.skip.push(event.start.toISODate()!);
                    updateChange({
                      type: "updated",
                      event: parent,
                    });

                    // the event never existed so no need to actually delete anything
                    break;
                  }

                  case "future": {
                    // end parent's repetition
                    parent.repeat.until = event.start.startOf("day").toMillis();
                    updateChange({
                      type: "updated",
                      event: parent,
                    });
                    break;
                  }

                  case "all": {
                    // delete the parent
                    dispatch({
                      type: "delete",
                      id: parent.id,
                    });

                    updateChange({
                      id: parent.id,
                      type: "deleted",
                    });

                    break;
                  }
                }

                toBeDeletedRef.current = null;
                setDeleteRepeatDialogOpen(false);

                save();
              }}
            >
              Delete
            </AlertDialogAction>
            <AlertDialogCancel
              onClick={() => {
                toBeDeletedRef.current = null;
                setDeleteRepeatDialogOpen(false);
              }}
            >
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
