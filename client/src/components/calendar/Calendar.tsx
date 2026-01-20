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
import { SidebarTrigger } from "@/components/ui/sidebar";

import type { CalendarProps } from "@/types/Props";
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
import {
  getDayEventStyles,
  mapEventToDate,
  mapEventToDates,
} from "@/lib/calendar/event";
import { useUser } from "@/context/UserContext";
import { toast } from "sonner";
import HeaderCell from "./HeaderCell";
import GridCell from "./GridCell";
import { useIsMobile } from "@/hooks/use-mobile";
import ModeSwitcher from "./ModeSwitcher";
import type { GridTouchRef } from "@/types/calendar/Cell";
import { clamp } from "@/lib/utils";
import RecurringUpdateDialog from "./RecurringUpdateDialog";
import type { PushEvent } from "@/types/Push";
import { CLIENT_ID } from "@/hooks/calendar/useCalendarEvents";

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
  syncEvents,
}: CalendarProps) {
  const { currentDate, setCurrentDate } = useCalendar();
  const [calendarEvents, dispatch] = useReducer(calendarReducer, events);
  const [isDragging, setIsDragging] = useState(false);
  const [hourHeight, setHourHeight] = useState(60);
  const [updateRepeatDialogOpen, setUpdateRepeatDialogOpen] = useState(false);
  const [deleteRepeatDialogOpen, setDeleteRepeatDialogOpen] = useState(false);
  const [now, setNow] = useState(DateTime.now());
  const [, forceRender] = useState(false);
  const changesMapRef = useRef<Map<string, EventChange[]>>(new Map());
  const pendingSaveRef = useRef(false);
  const { user, masterKey } = useUser();

  const { cols, rows } = GRID_CONFIG[mode as keyof typeof GRID_CONFIG];

  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<EventDragRef>(null);
  const gridTouchRef = useRef<GridTouchRef | null>(null);
  const hourHeightRef = useRef(hourHeight);

  const evPendingUpdateRef = useRef<CalendarEvent | null>(null);

  const visibleDays = useMemo(() => {
    return (
      {
        day: getDay(currentDate),
        week: getWeekDays(currentDate),
      }[mode] ?? []
    );
  }, [currentDate, mode]);

  const isMobile = useIsMobile();

  const move = useCallback(
    (steps: number) => {
      const unit =
        mode === "day" ? "days" : mode === "week" ? "weeks" : "months";
      setCurrentDate(currentDate.plus({ [unit]: steps }));
    },
    [currentDate, setCurrentDate, mode],
  );

  const getNowY = useCallback(() => {
    const minutes = now.hour * 60 + now.minute;
    return (minutes / 60) * hourHeight;
  }, [now, hourHeight]);

  const updateChange = useCallback(
    (change: EventChange) => {
      if (user?.type === "offline") return; // offline users save all events locally

      const key = change.event?.id ?? change.id!;
      const prev = changesMapRef.current.get(key) ?? [];

      if (change.event) change.event.timestamp = Date.now();

      let next: EventChange[];

      if (change.type === "updated") {
        next = prev.filter((c) => c.type !== "updated"); // delete old updates
        next.push(change);
      } else {
        next = [...prev, change];
      }

      changesMapRef.current.set(key, next);
    },
    [user?.type],
  );

  const saveIfChanged = useCallback(() => {
    if (changesMapRef.current.size > 0) {
      saveEvents(Array.from(changesMapRef.current.values()).flat(), () => {
        changesMapRef.current.clear(); // reset after save
      });
    }
  }, [saveEvents]);

  const save = useCallback(() => {
    if (user?.type === "online") saveIfChanged();
    else saveEvents(calendarEvents, () => {}); // save all events for offline users
    pendingSaveRef.current = false;
  }, [user, saveEvents, saveIfChanged, calendarEvents]);

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
    [visibleDays, hourHeight],
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

          dragRef.current = null;
          pendingSaveRef.current = true;
        } else if (dragRef.current.moved) {
          // if the event has a parent, ask what to do
          evPendingUpdateRef.current = event;
          setUpdateRepeatDialogOpen(true);
        }

        setIsDragging(false);

        window.removeEventListener("pointermove", onGlobalPointerMove);
        window.removeEventListener("pointerup", onGlobalPointerUp);
      }
    },
    [onGlobalPointerMove, updateChange, dispatch],
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

    // visibleDays is needed here for getDayRects to work
    // eslint-disable-next-line
    [visibleDays, onGlobalPointerMove, onGlobalPointerUp],
  );

  const onEventEdit = useCallback(
    (event: CalendarEvent) => {
      if (event.parent) {
        evPendingUpdateRef.current = event;
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

      pendingSaveRef.current = true;
    },
    [dispatch, updateChange],
  );

  const onEventDelete = useCallback(
    (event: CalendarEvent) => {
      if (event.parent) {
        setDeleteRepeatDialogOpen(true);
        evPendingUpdateRef.current = event;
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

      pendingSaveRef.current = true;
    },
    [setDeleteRepeatDialogOpen, dispatch, updateChange],
  );

  /* -------------------------------------------------------------------------- */

  const startNewEvent = useCallback(
    (e: React.PointerEvent, dayIndex: number) => {
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
    },
    [
      hourHeight,
      dispatch,
      updateChange,
      visibleDays,
      onGlobalPointerMove,
      onGlobalPointerUp,
    ],
  );

  const gridTouchStart = useCallback((e: React.TouchEvent) => {
    if (gridTouchRef.current != null || e.target !== e.currentTarget) return;

    gridTouchRef.current = {
      start: {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      },
    };
  }, []);

  const gridTouchMove = useCallback((e: React.TouchEvent) => {
    if (gridTouchRef.current === null) return;

    gridTouchRef.current.delta = {
      x: gridTouchRef.current.start.x - e.touches[0].clientX,
      y: gridTouchRef.current.start.y - e.touches[0].clientY,
    };

    // don't count x if swiping y (prevents accidental moves)
    if (Math.abs(gridTouchRef.current.delta.y) > 50)
      gridTouchRef.current.delta.x = 0;

    forceRender((prev) => !prev);
  }, []);

  const gridTouchEnd = useCallback(() => {
    if (gridTouchRef.current === null || !gridTouchRef.current.delta) return;

    if (Math.abs(gridTouchRef.current.delta.x) > 100) {
      move(gridTouchRef.current.delta.x > 0 ? 1 : -1);
    }

    gridTouchRef.current = null;
    forceRender((prev) => !prev);
  }, [move]);

  /* -------------------------------------------------------------------------- */

  // sync ref with state for zoom calculations
  useEffect(() => {
    hourHeightRef.current = hourHeight;
  }, [hourHeight]);

  // save when events update
  useEffect(() => {
    if (pendingSaveRef.current) save();
  }, [calendarEvents, save]);

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

  // resync calendar events periodically and on push message
  useEffect(() => {
    if (!user || !masterKey || user.type === "offline") return;

    const resync = async () => {
      toast.promise(
        new Promise<void>((resolve) => {
          syncEvents(user, masterKey).then((newEvents) => {
            dispatch({
              type: "set",
              events: newEvents,
            });

            resolve();
          });
        }),
        {
          loading: "Event sync in progress...",
        },
      );
    };

    const message = (ev: MessageEvent) => {
      const data = ev.data as PushEvent;
      if (data.type === "sync" && data.originClientId != CLIENT_ID) resync();
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", message);
    }

    const resyncInterval = setInterval(resync, 300000); // 5 minutes
    return () => {
      clearInterval(resyncInterval);

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", message);
      }
    };
  }, [syncEvents, user, masterKey]);

  // reset events when the defaults change
  useEffect(() => {
    dispatch({ type: "set", events });
  }, [events]);

  /* -------------------------------------------------------------------------- */

  // build map of (day: events) for optimal fetching
  const eventMap = useMemo(
    () => {
      const map = new Map<string, CalendarEvent[]>();
      const visibleDates = new Set(visibleDays.map((d) => d.date.toISODate()));

      for (const e of calendarEvents) {
        if (!e.id) continue;
        if (e.id === dragRef.current?.event.id && dragRef.current.moved)
          continue;

        mapEventToDates(map, e, visibleDates);

        // repeating event logic
        if (
          e.repeat &&
          (!dragRef.current?.moved || dragRef.current.event.parent !== e.id)
        ) {
          let cursor = e.start;
          const duration = e.end.diff(e.start);

          while (cursor <= visibleDays.at(-1)!.date.endOf("day")) {
            const dayIndex = cursor.weekday;
            const key = cursor.toISODate()!;

            if (
              cursor.toMillis() !== e.start.toMillis() &&
              visibleDates.has(key) &&
              (!e.repeat.until || cursor.toMillis() < e.repeat.until) &&
              !e.repeat.except?.includes(dayIndex) &&
              !e.repeat.skip?.includes(key)
            ) {
              mapEventToDate(map, key, {
                ...e,
                id: e.id + "_" + key,
                start: cursor,
                end: cursor.plus(duration),
                parent: e.id,
              });
            }

            cursor = cursor.plus({
              [e.repeat.unit]: e.repeat.interval,
            });
          }
        }
      }

      // temporary event while dragging
      if (dragRef.current?.event && dragRef.current.moved) {
        mapEventToDates(map, dragRef.current.event, visibleDates);
      }

      return map;
    },
    // dragRef.current... non-idiomatic but needed, refactor later ig
    // eslint-disable-next-line
    [
      calendarEvents,
      visibleDays,
      dragRef.current?.event?.start,
      dragRef.current?.event?.end,
    ],
  );

  // build map of event styles
  const stylesMap = useMemo(() => {
    const map = new Map<string, Record<string, EventStyle>>();

    for (const d of visibleDays) {
      const key = d.date.toISODate();
      if (!key) continue;

      const events = eventMap.get(key);
      if (!events?.length) continue;

      map.set(key, getDayEventStyles(events, d.date, hourHeight));
    }

    return map;
  }, [visibleDays, eventMap, hourHeight]);

  // for swipe gesture on mobile
  const swipeDelta = useMemo(() => {
    let delta = 0;

    if (gridTouchRef.current && gridTouchRef.current.delta) {
      delta = gridTouchRef.current.delta.x;
    }

    return delta;

    // non-idiomatic but needed, refactor later ig
    // eslint-disable-next-line
  }, [gridTouchRef.current?.delta?.x]);

  // headers in day/week view, one for every visibleDay
  const dayWeekHeaders = useMemo(
    () =>
      visibleDays.map((d) => (
        <HeaderCell
          key={d.label}
          className={`select-none ${isSameDate(d.date, DateTime.now()) ? "bg-card font-bold" : ""}`}
        >
          {d.label}
        </HeaderCell>
      )),
    [visibleDays],
  );

  // grid in day/week view
  const timeGrid = useMemo(
    () =>
      HOURS.map((label, hour) => (
        <Fragment key={label}>
          <div
            className={`select-none sticky left-0 z-5 border-r border-b flex text-sm items-center justify-center ${hour == now.hour ? "bg-card font-bold" : "bg-background"}`}
          >
            {label}
          </div>

          {visibleDays.map((d, dayIndex) => {
            const key = d.date.toISODate()!;
            const dayEvents = eventMap.get(key) || [];
            const styles = stylesMap.get(key) || {};

            return (
              <GridCell
                key={`${d.label}-${hour}`}
                day={dayIndex}
                onCellTap={startNewEvent}
                onTouchStart={gridTouchStart}
                onTouchMove={gridTouchMove}
                onTouchEnd={gridTouchEnd}
              >
                {hour === 0 && (
                  <div className="relative h-full">
                    <div style={{ height: hourHeight * 24 }} />

                    {/* current time indicator line */}
                    {isSameDate(d.date, now) && (
                      <div
                        className="pointer-events-none absolute left-0 right-0 z-15 shadow-xl bg-foreground
                    before:absolute before:-left-1 before:top-1/2
                    before:h-2 before:w-2 before:-translate-y-1/2
                    before:rounded-full before:bg-foreground"
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
                        onEventDelete={onEventDelete}
                      />
                    ))}
                  </div>
                )}
              </GridCell>
            );
          })}
        </Fragment>
      )),
    [
      eventMap,
      stylesMap,
      visibleDays,
      now,
      getNowY,
      hourHeight,
      gridTouchStart,
      gridTouchMove,
      gridTouchEnd,
      onEventEdit,
      onEventDelete,
      onEventPointerDown,
      startNewEvent,
    ],
  );

  return (
    <main className="flex h-screen w-full flex-col">
      {swipeDelta !== 0 && (
        <div
          className={`fixed top-1/2 z-100 ${Math.abs(swipeDelta) >= 100 ? "bg-foreground" : "bg-foreground/50"} text-background border p-1 rounded`}
          style={{
            [swipeDelta > 0 ? "right" : "left"]: "-80px",
            transform: `translateX(${clamp(-swipeDelta, -100, 100)}px)`,
          }}
        >
          {swipeDelta > 0 ? <ArrowRight /> : <ArrowLeft />}
        </div>
      )}
      <nav className="flex items-center justify-between border-b p-3">
        {isMobile && <SidebarTrigger />}

        <div className="flex items-center gap-2 hidden md:flex">
          <Button
            variant="outline"
            onClick={() => setCurrentDate(DateTime.now())}
          >
            Today
          </Button>
          <Button
            data-testid="prev-btn"
            variant="outline"
            size="icon"
            onClick={() => move(-1)}
          >
            <ArrowLeft />
          </Button>
          <Button
            data-testid="next-btn"
            variant="outline"
            size="icon"
            onClick={() => move(1)}
          >
            <ArrowRight />
          </Button>
          <h2 className="ml-2 text-xl">
            {getDateRangeString(mode, currentDate)}
          </h2>
        </div>

        <h2 className="flex-1 text-xl ml-6 md:hidden">
          {getDateRangeString(mode, currentDate)}
        </h2>

        <ModeSwitcher mode={mode} setMode={setMode} />

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

      <RecurringUpdateDialog
        action="Update"
        defaultOption="this"
        open={updateRepeatDialogOpen}
        setOpen={setUpdateRepeatDialogOpen}
        onSubmit={(option: string) => {
          const event = evPendingUpdateRef.current;
          const parent = calendarEvents.find((e) => e.id === event?.parent);
          if (!event || !parent || !parent.repeat) {
            toast.error("Event no longer exists.");
            dragRef.current = null;
            setUpdateRepeatDialogOpen(false);
            return;
          }

          const evStart = dragRef.current
            ? dragRef.current.originalStart
            : event.start;

          switch (option) {
            case "this": {
              // skip current repetition
              if (!parent.repeat.skip) parent.repeat.skip = [];
              parent.repeat.skip.push(evStart.toISODate()!);

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
                  day: parent.start.day - (evStart.day - event.start.day),
                  hour: event.start.hour,
                  minute: event.start.minute,
                }),
                end: parent.end.set({
                  day: parent.end.day - (evStart.day - event.end.day),
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
          evPendingUpdateRef.current = null;
          pendingSaveRef.current = true;
        }}
        onCancel={() => {
          dragRef.current = null;
          evPendingUpdateRef.current = null;
        }}
      />

      <RecurringUpdateDialog
        action="Delete"
        defaultOption="this"
        open={deleteRepeatDialogOpen}
        setOpen={setDeleteRepeatDialogOpen}
        onSubmit={(option: string) => {
          const event = evPendingUpdateRef?.current;
          const parent = calendarEvents.find((e) => e.id === event?.parent);
          if (
            !evPendingUpdateRef.current ||
            !event ||
            !parent ||
            !parent.repeat
          ) {
            toast.error("Event no longer exists.");
            evPendingUpdateRef.current = null;
            setDeleteRepeatDialogOpen(false);
            return;
          }

          switch (option) {
            case "this": {
              // skip current repetition
              if (!parent.repeat.skip) parent.repeat.skip = [];
              parent.repeat.skip.push(event.start.toISODate()!);

              dispatch({
                type: "update",
                id: parent.id,
                data: parent,
              });

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

              dispatch({
                type: "update",
                id: parent.id,
                data: parent,
              });

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

          evPendingUpdateRef.current = null;
          pendingSaveRef.current = true;
        }}
        onCancel={() => {
          evPendingUpdateRef.current = null;
        }}
      />
    </main>
  );
}
