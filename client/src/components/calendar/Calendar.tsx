import {
  useRef,
  useState,
  Fragment,
  useMemo,
  useEffect,
  useCallback,
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
import { getDayEventStyles, getEventMap } from "@/lib/calendar/event";
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
import { EMPTY_ARRAY } from "@/lib/constants";

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
  const {
    editingEvent,
    currentDate,
    calendarEvents,
    setCurrentDate,
    dispatch,
    setEditingEvent,
  } = useCalendar();
  const [isDragging, setIsDragging] = useState(false);
  const [hourHeight, setHourHeight] = useState(60);
  const [updateRepeatDialogOpen, setUpdateRepeatDialogOpen] = useState(false);
  const [deleteRepeatDialogOpen, setDeleteRepeatDialogOpen] = useState(false);
  const [now, setNow] = useState(DateTime.now());
  const [, forceRender] = useState(false);
  const changesMapRef = useRef<Map<string, EventChange[]>>(new Map());
  const pendingSaveRef = useRef<null | number>(null);
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
      if (dragRef.current)
        dragRef.current.originalDay -= mode === "day" ? steps : steps * 7;
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
    if (pendingSaveRef.current !== null) clearTimeout(pendingSaveRef.current);

    pendingSaveRef.current = setTimeout(() => {
      pendingSaveRef.current = null;

      if (user?.type === "online") saveIfChanged();
      else saveEvents(calendarEvents, () => {}); // save all events for offline users
    }, 100);
  }, [calendarEvents, saveEvents, saveIfChanged, user?.type]);

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
      const diff = newEnd.diff(newStart).shiftTo("hours", "minutes");
      const hours = Math.floor(diff.hours);
      const minutes = Math.round(diff.minutes);
      const durText = [];
      if (hours > 0) durText.push(`${hours} hr${hours !== 1 ? "s" : ""}`);
      if (minutes > 0) durText.push(`${minutes} min`);
      state.label = `${newStart.toFormat("t")} - ${newEnd.toFormat("t")}\n${durText.join(" ")}`;
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
        if (!event.parent && !event.repeat) {
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
          save();
        } else if (dragRef.current.moved) {
          if (
            event.start.toMillis() !== state.originalStart.toMillis() ||
            event.end.toMillis() !== state.originalEnd.toMillis()
          ) {
            // if the event has or is a parent, ask what to do
            evPendingUpdateRef.current = event;
            setUpdateRepeatDialogOpen(true);
          } else {
            // if it didn't actually update, just revert
            dragRef.current = null;
          }
        }

        setIsDragging(false);

        window.removeEventListener("pointermove", onGlobalPointerMove);
        window.removeEventListener("pointerup", onGlobalPointerUp);
      }
    },
    [onGlobalPointerMove, updateChange, dispatch, save],
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
    (originalEvent: CalendarEvent, event: CalendarEvent) => {
      if (event.parent || originalEvent.repeat) {
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

      save();
    },
    [dispatch, updateChange, save],
  );

  const onEventDelete = useCallback(
    (event: CalendarEvent) => {
      if (event.parent || event.repeat) {
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

      save();
    },
    [setDeleteRepeatDialogOpen, dispatch, updateChange, save],
  );

  const onEventDuplicate = useCallback(
    (event: CalendarEvent) => {
      const newEvent = {
        ...event,
        id: crypto.randomUUID(),
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

      setEditingEvent(null);
      save();
    },
    [dispatch, updateChange, setEditingEvent, save],
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
    const targetElement = e.target as Element;
    if (
      gridTouchRef.current != null ||
      targetElement.closest(".event-editor") ||
      !targetElement.closest(".grid-cell")
    )
      return;

    gridTouchRef.current = {
      start: {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      },
    };
  }, []);

  const gridTouchMove = useCallback((e: React.TouchEvent) => {
    if (gridTouchRef.current === null) return;

    // pinch to zoom
    if (e.touches.length === 2) {
      gridTouchRef.current.delta = { x: 0, y: 0 };

      const a = e.touches.item(0);
      const b = e.touches.item(1);

      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);

      // compute distance on first run
      if (gridTouchRef.current.distance === undefined) {
        gridTouchRef.current.distance = dist;
        return;
      }

      const container = gridRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const midpointY =
        (a.clientY + b.clientY) / 2 - rect.top + container.scrollTop;

      if (gridTouchRef.current.distance !== undefined) {
        const delta = dist / gridTouchRef.current.distance;

        if (!gridTouchRef.current.raf) {
          gridTouchRef.current.raf = requestAnimationFrame(() => {
            setHourHeight((prev) => {
              const next = clamp(prev * delta, 20, 300);

              const zoomFactor = next / prev;
              container.scrollTop =
                midpointY * zoomFactor - (midpointY - container.scrollTop);

              return next;
            });
            gridTouchRef.current!.raf = undefined;
          });
        }
      }

      gridTouchRef.current.distance = dist;
      return;
    }

    gridTouchRef.current.distance = undefined;
    gridTouchRef.current.delta = {
      x: gridTouchRef.current.start.x - e.touches[0].clientX,
      y: gridTouchRef.current.start.y - e.touches[0].clientY,
    };

    // don't count x if swiping y (prevents accidental moves)
    if (Math.abs(gridTouchRef.current.delta.y) > 50)
      gridTouchRef.current.delta.x = 0;

    gridTouchRef.current.raf = requestAnimationFrame(() =>
      forceRender((prev) => !prev),
    );
  }, []);

  const gridTouchEnd = useCallback(() => {
    if (gridTouchRef.current === null) return;

    if (
      gridTouchRef.current.delta &&
      Math.abs(gridTouchRef.current.delta.x) > 100
    ) {
      move(gridTouchRef.current.delta.x > 0 ? 1 : -1);
    }

    gridTouchRef.current.distance = undefined;
    if (gridTouchRef.current.raf)
      cancelAnimationFrame(gridTouchRef.current.raf);

    gridTouchRef.current = null;
    forceRender((prev) => !prev);
  }, [move]);

  /* -------------------------------------------------------------------------- */

  // sync ref with state for zoom calculations
  useEffect(() => {
    hourHeightRef.current = hourHeight;
  }, [hourHeight]);

  // zoom in with ctrl + mouse wheel
  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      const delta = e.deltaY > 0 ? -10 : 10;
      const newHeight = Math.max(
        20,
        Math.min(300, hourHeightRef.current + delta),
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
        new Promise<void>((resolve, reject) => {
          syncEvents(user, masterKey)
            .then((newEvents) => {
              dispatch({
                type: "set",
                events: newEvents,
              });

              resolve();
            })
            .catch(() => reject());
        }),
        {
          loading: "Event sync in progress...",
          error: "Failed to sync calendar events.",
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
  }, [syncEvents, user, masterKey, dispatch]);

  // reset events when the defaults change
  useEffect(() => {
    dispatch({ type: "set", events });
  }, [events, dispatch]);

  /* -------------------------------------------------------------------------- */

  const dragEvent = dragRef.current?.moved ? dragRef.current?.event : null;
  const dragEventClean = useMemo(
    () =>
      ({
        ...dragEvent,
        repeat: undefined,
      }) as CalendarEvent,
    // non-idiomatic but necessary - refactor later
    // eslint-disable-next-line
    [dragEvent?.start, dragEvent?.end],
  );
  const dragDerived = useMemo(() => {
    if (!dragEvent) {
      return { exclude: EMPTY_ARRAY, append: EMPTY_ARRAY };
    }

    return {
      exclude: [dragEvent.id],
      append: [dragEventClean],
    };
  }, [dragEvent, dragEventClean]);

  const visibleDates = useMemo(
    () => visibleDays.map((d) => d.date),
    [visibleDays],
  );

  // build map of (day: events) for optimal fetching
  const eventMap = useMemo(
    () =>
      getEventMap(
        calendarEvents,
        visibleDates,
        dragDerived.exclude,
        dragDerived.append,
      ),
    [calendarEvents, visibleDates, dragDerived],
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
          className={`select-none ${isSameDate(d.date, now) ? "bg-card font-bold" : ""}`}
        >
          {d.label}
        </HeaderCell>
      )),
    [visibleDays, now],
  );

  // grid in day/week view
  const timeGrid = useMemo(
    () =>
      HOURS.map((label, hour) => (
        <Fragment key={label}>
          <div
            className={`select-none sticky left-0 z-5 shadow-[inset_-1px_-1px_0_0_var(--foreground)]/10 flex text-sm items-center justify-center ${hour == now.hour ? "bg-card font-bold" : "bg-background"}`}
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
                        date={d.date}
                        style={styles[event.id]}
                        editing={editingEvent?.id === event.id}
                        onPointerDown={onEventPointerDown}
                        onEventEdit={onEventEdit}
                        onEventDelete={onEventDelete}
                        onDuplicate={onEventDuplicate}
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
      onEventEdit,
      onEventDelete,
      onEventDuplicate,
      onEventPointerDown,
      startNewEvent,
      editingEvent,
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
          className="touch-pan-y grid h-full overflow-auto"
          style={{
            gridTemplateColumns: cols,
            gridTemplateRows: rows(hourHeight),
          }}
          onTouchStart={gridTouchStart}
          onTouchMove={gridTouchMove}
          onTouchEnd={gridTouchEnd}
        >
          <div className="sticky left-0 top-0 z-5 shadow-[inset_-1px_-1px_0_0_var(--foreground)]/10 bg-background" />

          {dayWeekHeaders}
          {timeGrid}

          {isDragging && <DragOverlay move={move} dragRef={dragRef} />}
        </div>
      </div>

      <RecurringUpdateDialog
        action="Update"
        defaultOption="this"
        open={updateRepeatDialogOpen}
        setOpen={setUpdateRepeatDialogOpen}
        onSubmit={(option: string) => {
          const event = evPendingUpdateRef.current;

          if (!event) {
            toast.error("Event no longer exists.");
            dragRef.current = null;
            setUpdateRepeatDialogOpen(false);
            return;
          }

          const isParent = !event.parent && event.repeat;
          const parent = isParent
            ? event
            : calendarEvents.find((e) => e.id === event.parent);

          if (!parent?.repeat) {
            dispatch({
              type: "update",
              id: event.id,
              data: event,
            });

            updateChange({
              type: "updated",
              event,
            });

            return;
          }

          const evStart = dragRef.current
            ? dragRef.current.originalStart
            : event.start;

          const evEnd = dragRef.current
            ? dragRef.current.originalEnd
            : event.end;

          switch (option) {
            case "this": {
              // clone the event
              const newEvent = {
                ...event,
                id: crypto.randomUUID(),
                timestamp: Date.now(),
              } as CalendarEvent;

              if (isParent) {
                // move parent to next non-skipped repetition
                const interval = {
                  [parent.repeat.unit]: parent.repeat.interval,
                };

                let nextStart = evStart.plus(interval);
                let nextEnd = evEnd.plus(interval);

                if (parent.repeat.skip?.length) {
                  const skipped = new Set(parent.repeat.skip);

                  while (skipped.has(nextStart.toISODate()!)) {
                    nextStart = nextStart.plus(interval);
                    nextEnd = nextEnd.plus(interval);
                  }
                }

                parent.start = nextStart;
                parent.end = nextEnd;
              } else {
                // skip current repetition
                if (!parent.repeat.skip) parent.repeat.skip = [];
                parent.repeat.skip.push(evStart.toISODate()!);
              }

              updateChange({
                type: "updated",
                event: parent,
              });

              dispatch({
                type: "update",
                id: parent.id,
                data: parent,
              });

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
              if (isParent) {
                // update everything
                dispatch({
                  type: "update",
                  id: parent.id,
                  data: event,
                });

                updateChange({
                  type: "updated",
                  event,
                });

                break;
              }

              // clone the event
              const newEvent = {
                ...event,
                id: crypto.randomUUID(),
                timestamp: Date.now(),
                repeat: {
                  interval: parent.repeat.interval,
                  unit: parent.repeat.unit,
                  except: parent.repeat.except,
                  until: parent.repeat.until,
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
              if (isParent) {
                dispatch({
                  type: "update",
                  id: parent.id,
                  data: event,
                });

                updateChange({
                  type: "updated",
                  event,
                });

                break;
              }

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
          save();
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

          if (!evPendingUpdateRef.current || !event) {
            toast.error("Event no longer exists.");
            evPendingUpdateRef.current = null;
            setDeleteRepeatDialogOpen(false);
            return;
          }

          const isParent = !event.parent && event.repeat;
          const parent = isParent
            ? event
            : calendarEvents.find((e) => e.id === event.parent);

          // if the event has no parents or children just delete it
          if (!parent?.repeat) {
            dispatch({
              type: "delete",
              id: event.id,
            });

            updateChange({
              id: event.id,
              type: "deleted",
            });

            save();
            return;
          }

          switch (option) {
            case "this": {
              if (isParent) {
                // move parent to next non-skipped repetition
                const interval = {
                  [parent.repeat.unit]: parent.repeat.interval,
                };

                let nextStart = event.start.plus(interval);
                let nextEnd = event.end.plus(interval);

                if (parent.repeat.skip?.length) {
                  const skipped = new Set(parent.repeat.skip);

                  while (skipped.has(nextStart.toISODate()!)) {
                    nextStart = nextStart.plus(interval);
                    nextEnd = nextEnd.plus(interval);
                  }
                }

                parent.start = nextStart;
                parent.end = nextEnd;
              } else {
                // skip current repetition
                if (!parent.repeat.skip) parent.repeat.skip = [];
                parent.repeat.skip.push(event.start.toISODate()!);
              }

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
              if (isParent) {
                // deleting the parent removes the chain
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
          save();
        }}
        onCancel={() => {
          evPendingUpdateRef.current = null;
        }}
      />
    </main>
  );
}
