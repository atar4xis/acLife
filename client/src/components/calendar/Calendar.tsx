import {
  memo,
  useRef,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useEffectEvent,
  type CSSProperties,
} from "react";
import { DateTime } from "luxon";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  SearchIcon,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

import type { CalendarProps } from "@/types/calendar/Props";
import type {
  CalendarEvent,
  EventChange,
  EventDragRef,
  EventStyle,
} from "@/types/calendar/Event";
import EventBlock from "./EventBlock";
import DragOverlay from "./DragOverlay";
import {
  useCalendarActions,
  useCurrentDate,
  useEditing,
  useViewing,
  useEventList,
} from "@/context/CalendarContext";
import {
  EVENT_COLOR_FALLBACK,
  MAX_EVENT_COLOR_PRESETS,
  useCalendarSettings,
} from "@/context/CalendarSettingsContext";
import {
  getDay,
  getWeekDays,
  yToMinutes,
  snapMinutes,
  isSameDate,
  getDateRangeString,
} from "@/lib/calendar/date";
import {
  ALL_DAY_MAX_ROWS,
  ALL_DAY_MIN_ROWS,
  ALL_DAY_ROW_HEIGHT,
  barKey,
  barRow,
  barSpans,
  layoutBars,
  resizeAllDay,
} from "@/lib/calendar/eventBars";
import { getDayRects, getEventRects } from "@/lib/calendar/dom";
import {
  GRID_HEADER_HEIGHT,
  NO_BOTTOM_BORDER,
  BOTTOM_BORDER_ONLY,
  ALL_DAY_CELL,
  getTimezoneColWidth,
  GRID_CONFIG,
  HOURS,
} from "@/lib/calendar/gridLayout";
import {
  SELECT_DRAG_THRESHOLD,
  AUTO_SCROLL_ZONE,
  AUTO_SCROLL_SPEED,
  resolveSelection,
  getBoxedKeys,
  getEventsByKey,
  getDraggedTimes,
  KEYBOARD_DRAG_ID,
  describeDragLabel,
  isAtOriginal,
  applyTimes,
  toAllDay,
  toTimed,
  applyDragDelta,
  applyDragWithResize,
} from "@/lib/calendar/drag";

import { describeFullDay } from "@/lib/calendar/a11y";
import { shortcutsApply } from "@/lib/calendar/shortcutScope";
import { ALL_DAY_SLOT, createGridFocusStore } from "@/lib/calendar/gridFocus";
import useGridKeyboard from "@/hooks/useGridKeyboard";
import { useKeyboardMode } from "@/hooks/useGridFocus";
import { SpokenMessage, SlotIndicator } from "./GridFocus";
import ScrollThumb from "./ScrollThumb";
import UndoRedoButtons from "./UndoRedoButtons";
import { getTimezoneHourLabel } from "@/lib/calendar/timezone";
import { useWeekStart } from "@/hooks/useWeekStart";
import {
  MAX_CLIPBOARD_EVENTS,
  MAX_EVENTS_PER_DAY,
  countEventsOnDay,
  eventKey,
  stateTargets,
  getDayEventStyles,
  getEventMap,
  getEventPixelPosition,
  sameNotifications,
} from "@/lib/calendar/event";
import { weekLabel } from "@/lib/calendar/buckets";
import { useUser } from "@/context/UserContext";
import { toast } from "sonner";
import HeaderCell from "./HeaderCell";
import TimezoneHeaderCell from "./TimezoneHeaderCell";
import GridCell from "./GridCell";
import { useIsMobile } from "@/hooks/use-mobile";
import ModeSwitcher from "./ModeSwitcher";
import type { GridSelectionRef, GridTouchRef } from "@/types/calendar/Cell";
import { clamp, cn } from "@/lib/utils";
import RecurringUpdateDialog from "./RecurringUpdateDialog";
import { resolveDefaultName } from "@/lib/calendar/defaultNames";
import { fmt, t as translate } from "@/i18n";
import { repeatChanged } from "@/lib/calendar/repeatOptions";
import {
  detachSingleOccurrence,
  isChainParent,
  cutPoint,
  endSeriesBefore,
  futureOverrides,
  overridesBefore,
  resetOccurrence,
  splitSeries,
  withShiftedOverrides,
  skipSingleOccurrence,
} from "@/lib/calendar/recurrence";
import { onStream } from "@/lib/stream";
import { useCalendarSearch } from "@/hooks/calendar/useCalendarSearch";
import { EMPTY_ARRAY } from "@/lib/constants";
import type { RejectedEvent, RepeatInterval } from "@/types/calendar/Event";
import { useTranslation } from "react-i18next";

const joined = (values?: (string | number)[]) => values?.join(",") ?? "";

const repeatEqual = (a?: RepeatInterval, b?: RepeatInterval) => {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.interval === b.interval &&
    a.unit === b.unit &&
    a.until === b.until &&
    a.count === b.count &&
    a.monthly === b.monthly &&
    joined(a.days) === joined(b.days) &&
    joined(a.yearDays) === joined(b.yearDays) &&
    joined(a.except) === joined(b.except) &&
    joined(a.skip) === joined(b.skip) &&
    JSON.stringify(a.overrides) === JSON.stringify(b.overrides)
  );
};

const eventUnchanged = (a: CalendarEvent, b: CalendarEvent) =>
  a.title === b.title &&
  a.description === b.description &&
  a.color === b.color &&
  a.start.toMillis() === b.start.toMillis() &&
  a.end.toMillis() === b.end.toMillis() &&
  a.isTask === b.isTask &&
  a.allDay === b.allDay &&
  a.completed === b.completed &&
  sameNotifications(a.notifications, b.notifications) &&
  repeatEqual(a.repeat, b.repeat);

const serializeEventForDiff = (ev: CalendarEvent) => {
  const clean = Object.fromEntries(
    Object.entries(ev).filter(([key]) => !key.startsWith("_")),
  );

  return JSON.stringify({
    ...clean,
    timestamp: undefined,
    start: ev.start.toMillis(),
    end: ev.end.toMillis(),
    deadline: ev.deadline?.toMillis(),
  });
};

const diffForHistory = (
  target: CalendarEvent[],
  current: CalendarEvent[],
): EventChange[] => {
  const currentMap = new Map(current.map((ev) => [ev.id, ev]));
  const targetMap = new Map(target.map((ev) => [ev.id, ev]));
  const changes: EventChange[] = [];

  for (const [id, ev] of targetMap) {
    const cur = currentMap.get(id);
    if (!cur) changes.push({ type: "added", event: ev });
    else if (serializeEventForDiff(cur) !== serializeEventForDiff(ev)) {
      changes.push({ type: "updated", event: ev });
    }
  }

  for (const id of currentMap.keys()) {
    if (!targetMap.has(id)) changes.push({ type: "deleted", id });
  }

  return changes;
};

const withTimeOfDay = (date: DateTime, time: DateTime) =>
  date.set({
    hour: time.hour,
    minute: time.minute,
    second: time.second,
    millisecond: time.millisecond,
  });

const applyBatchField = (
  base: DateTime,
  edited: DateTime,
  dateChanged: boolean,
  timeChanged: boolean,
) => {
  if (dateChanged && timeChanged) return edited;
  if (timeChanged) return withTimeOfDay(base, edited);
  if (dateChanged) {
    return base.set({
      year: edited.year,
      month: edited.month,
      day: edited.day,
    });
  }
  return base;
};

/* -------------------------------------------------------------------------- */

const blockTouchMove = (e: Event) => {
  if (e.cancelable) e.preventDefault();
};

const touchBlockTarget: { current: EventTarget | null } = { current: null };

const releaseTouchBlock = () => {
  touchBlockTarget.current?.removeEventListener("touchmove", blockTouchMove);
  touchBlockTarget.current = null;
  window.removeEventListener("touchmove", blockTouchMove);
};

const HISTORY_LIMIT = 40;

const NO_DRAG = { exclude: EMPTY_ARRAY, append: EMPTY_ARRAY };

/* -------------------------------------------------------------------------- */

// TODO: clean this up, separate into smaller components and hooks
export default memo(function AppCalendar({
  events,
  mode,
  setMode,
  saveEvents,
  syncEvents,
  syncBuckets,
  saveDebounceMs = 100,
}: CalendarProps) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.dir() === "rtl";
  const {
    setCurrentDate,
    dispatch,
    setEditingEvent,
    setViewingEvent,
    selection,
    setEventHandlers,
    pendingChanges,
  } = useCalendarActions();
  const currentDate = useCurrentDate();
  const calendarEvents = useEventList();
  const { event: editingEvent, day: editingEventDay } = useEditing();
  const viewing = useViewing();
  const {
    toggle: toggleSelection,
    select: selectEvents,
    clear: clearSelection,
  } = selection;
  const [isDragging, setIsDragging] = useState(false);
  const [allDayExpanded, setAllDayExpanded] = useState(false);
  const autoExpanded = useRef(false);
  const [hourHeight, setHourHeight] = useState(60);
  const [updateRepeatDialogOpen, setUpdateRepeatDialogOpen] = useState(false);
  const [deleteRepeatDialogOpen, setDeleteRepeatDialogOpen] = useState(false);
  const [now, setNow] = useState<DateTime>(DateTime.now());
  const [renderTick, forceRender] = useState(0);
  const pendingSaveRef = useRef<null | number>(null);
  const { user, masterKey, bucketKey } = useUser();
  const { weekStart: weekStartsOn } = useWeekStart();
  const settings = useCalendarSettings((s) => ({
    snapMinutes: s.snapMinutes,
    lineOpacity: s.lineOpacity,
    defaultEventName: s.defaultEventName,
    defaultEventNotifications: s.defaultEventNotifications,
    defaultTaskName: s.defaultTaskName,
    defaultEventDuration: s.defaultEventDuration,
    resyncIntervalMinutes: s.resyncIntervalMinutes,
    addColorsAutomatically: s.addColorsAutomatically,
    detachRecurringOnEdit: s.detachRecurringOnEdit,
    followCurrentTime: s.followCurrentTime,
    eventColorPresets: s.eventColorPresets,
    timezones: s.timezones,
    defaultTimezone: s.defaultTimezone,
    dayHeaderPosition: s.dayHeaderPosition,
    timeLabelPosition: s.timeLabelPosition,
    setSetting: s.setSetting,
  }));
  const [searchOpen, setSearchOpen] = useState(false);
  const searchAnchorRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const onExpandedSearchEvents = useCallback(
    (newEvents: CalendarEvent[]) =>
      dispatch({ type: "append", events: newEvents }),
    [dispatch],
  );

  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    results: searchResults,
    isExpanding: isSearchExpanding,
    canExpandMore: canExpandSearchRadius,
    expandSearchRadius,
  } = useCalendarSearch(
    calendarEvents,
    user,
    masterKey,
    bucketKey,
    currentDate,
    syncBuckets,
    onExpandedSearchEvents,
  );

  const pendingScrollRef = useRef<CalendarEvent | null>(null);

  const onSelectSearchResult = useCallback(
    (event: CalendarEvent) => {
      pendingScrollRef.current = event;
      setCurrentDate(event.start);
      setSearchOpen(false);
    },
    [setCurrentDate],
  );

  const { cols, rows } = GRID_CONFIG[mode as keyof typeof GRID_CONFIG];
  const headerBottom = settings.dayHeaderPosition === "bottom";
  const labelsRight =
    settings.timeLabelPosition === "auto"
      ? rtl
      : settings.timeLabelPosition === "right";
  const headerZoneRef = useRef(GRID_HEADER_HEIGHT);
  const getGridHeaderOffset = useCallback(
    () => (headerBottom ? 0 : headerZoneRef.current),
    [headerBottom],
  );

  const isOverAllDay = useCallback(
    (y: number, rect: DOMRect) =>
      headerBottom
        ? y > rect.bottom - headerZoneRef.current
        : y < rect.top + headerZoneRef.current,
    [headerBottom],
  );

  const gridRef = useRef<HTMLDivElement>(null);
  const [focusStore] = useState(createGridFocusStore);
  const keyboardMode = useKeyboardMode(focusStore);
  const dragRef = useRef<EventDragRef>(null);
  const gridTouchRef = useRef<GridTouchRef | null>(null);
  const eventMapRef = useRef<Map<string, CalendarEvent[]> | null>(null);
  const selectionBoxRef = useRef<GridSelectionRef | null>(null);
  const hourHeightRef = useRef(hourHeight);

  const evPendingRef = useRef<{
    event: CalendarEvent;
    original: CalendarEvent | null;
  } | null>(null);
  const calendarEventsRef = useRef(calendarEvents);
  const selectedEventsRef = useRef(selection.get());
  const [canKeepChanges, setCanKeepChanges] = useState(false);

  const askUpdateScope = useCallback(
    (event: CalendarEvent, original: CalendarEvent | null) => {
      const parent =
        calendarEventsRef.current.find((e) => e.id === event._parent) ?? event;
      evPendingRef.current = { event, original };
      setCanKeepChanges(!!event._parent && !!futureOverrides(parent, event));
      setUpdateRepeatDialogOpen(true);
    },
    [],
  );

  useEffect(() => {
    selectedEventsRef.current = selection.get();
    return selection.subscribe(() => {
      selectedEventsRef.current = selection.get();
    });
  }, [selection]);

  const historyRef = useRef<{
    past: CalendarEvent[][];
    future: CalendarEvent[][];
  }>({ past: [], future: [] });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const syncHistory = useCallback(() => {
    const { past, future } = historyRef.current;
    setCanUndo(past.length > 0);
    setCanRedo(future.length > 0);
  }, []);
  const clipboardRef = useRef<CalendarEvent[]>([]);
  const gridPointerRef = useRef<{ x: number; y: number } | null>(null);

  const visibleDays = useMemo(() => {
    return (
      {
        day: getDay(currentDate),
        week: getWeekDays(currentDate, weekStartsOn),
      }[mode] ?? []
    );
    // eslint-disable-next-line
  }, [currentDate, mode, weekStartsOn, t]);

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

  const centerOnNow = useCallback(() => {
    const container = gridRef.current;
    if (!container) return;
    container.scrollTo({
      top: Math.max(
        0,
        getNowY() + getGridHeaderOffset() - container.clientHeight / 2,
      ),
      behavior: "instant",
    });
  }, [getNowY, getGridHeaderOffset]);

  const goToToday = useCallback(() => {
    setCurrentDate(DateTime.now());
    centerOnNow();
  }, [setCurrentDate, centerOnNow]);

  const onFollowTime = useEffectEvent(centerOnNow);

  const showsToday = visibleDays.some((d) => isSameDate(d.date, now));

  // follow the current time after 30s without scrolling or when the window loses focus
  useEffect(() => {
    const container = gridRef.current;
    if (!settings.followCurrentTime || !showsToday || !container) return;

    let timer: number;
    const arm = () => {
      clearTimeout(timer);
      timer = window.setTimeout(onFollowTime, 30000);
    };
    const onBlur = () => {
      clearTimeout(timer);
      onFollowTime();
    };

    arm();
    container.addEventListener("scroll", arm, { passive: true });
    window.addEventListener("blur", onBlur);
    return () => {
      clearTimeout(timer);
      container.removeEventListener("scroll", arm);
      window.removeEventListener("blur", onBlur);
    };
  }, [settings.followCurrentTime, showsToday]);

  const updateChange = useCallback(
    (change: EventChange) => {
      if (user?.type === "offline") return; // offline users save all events locally

      const key = change.event?.id ?? change.id!;
      const prev = pendingChanges.get(key) ?? [];

      if (change.event) change.event.timestamp = Date.now();

      let next: EventChange[];

      if (change.type === "updated") {
        next = prev.filter((c) => c.type !== "updated"); // delete old updates
        next.push(change);
      } else {
        next = [...prev, change];
      }

      pendingChanges.set(key, next);
    },
    [user?.type, pendingChanges],
  );

  useEffect(() => () => pendingChanges.clear(), [pendingChanges]);

  const resyncRef = useRef<() => void>(() => {});

  // the server never got these, so undo them
  const onRejected = useCallback(
    (rejected: RejectedEvent[]) => {
      const byId = new Map(rejected.map((r) => [r.id, r]));
      for (const id of byId.keys()) pendingChanges.delete(id);

      const restore = (events: CalendarEvent[]) =>
        events.flatMap((e) => {
          const r = byId.get(e.id);
          if (!r) return [e];
          if (r.previous) return [r.previous];
          return r.wasAdded ? [] : [e];
        });

      const history = historyRef.current;
      history.past = history.past.map(restore);
      history.future = history.future.map(restore);
      syncHistory();
      dispatch({ type: "set", events: restore(calendarEventsRef.current) });

      if (rejected.some((r) => !r.previous && !r.wasAdded)) resyncRef.current();
    },
    [dispatch, syncHistory, pendingChanges],
  );

  const saveIfChanged = useCallback(() => {
    const sent = new Map(pendingChanges);
    if (sent.size === 0) return;

    saveEvents(
      Array.from(sent.values()).flat(),
      () => {
        // an entry that changed since the snapshot still has unsaved changes
        for (const [key, changes] of sent) {
          if (pendingChanges.get(key) === changes) {
            pendingChanges.delete(key);
          }
        }
      },
      onRejected,
    );
  }, [saveEvents, onRejected, pendingChanges]);

  const save = useCallback(() => {
    if (pendingSaveRef.current !== null) clearTimeout(pendingSaveRef.current);

    pendingSaveRef.current = setTimeout(() => {
      pendingSaveRef.current = null;

      if (user?.type === "online") saveIfChanged();
      else saveEvents(calendarEventsRef.current, () => {}); // save all events for offline users
    }, saveDebounceMs);
  }, [saveEvents, saveIfChanged, user?.type, saveDebounceMs]);

  const pushHistory = useCallback(() => {
    const history = historyRef.current;
    history.past.push(calendarEventsRef.current);
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    history.future = [];
    syncHistory();
  }, [syncHistory]);

  const applyHistorySnapshot = useCallback(
    (target: CalendarEvent[]) => {
      const current = calendarEventsRef.current;
      for (const change of diffForHistory(target, current)) {
        updateChange(change);
      }

      dispatch({ type: "set", events: target });
      setEditingEvent(null);
      clearSelection();
      save();
    },
    [dispatch, updateChange, setEditingEvent, clearSelection, save],
  );

  const undo = useCallback(() => {
    const history = historyRef.current;
    const target = history.past.pop();
    if (!target) return;

    history.future.push(calendarEventsRef.current);
    if (history.future.length > HISTORY_LIMIT) history.future.shift();
    applyHistorySnapshot(target);
    syncHistory();
  }, [applyHistorySnapshot, syncHistory]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const target = history.future.pop();
    if (!target) return;

    history.past.push(calendarEventsRef.current);
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    applyHistorySnapshot(target);
    syncHistory();
  }, [applyHistorySnapshot, syncHistory]);

  /* -------------------------------------------------------------------------- */

  const showDragStep = useCallback(
    (
      state: NonNullable<EventDragRef>,
      step: { newStart: DateTime; newEnd: DateTime; changed: boolean },
    ) => {
      state.label = describeDragLabel(
        {
          start: step.newStart,
          end: step.newEnd,
          allDay: state.event.allDay,
        },
        state.selection?.length,
      );
      if (step.changed) {
        state.moved = true;
        forceRender((tick) => tick + 1);
      }
    },
    [],
  );

  const onGlobalPointerMove = useCallback(
    (e: PointerEvent) => {
      const state = dragRef.current;
      if (!state || e.pointerId !== state.pointerId) return;

      // stop the page from scrolling while dragging an event on a touch screen
      if (e.pointerType === "touch" && e.cancelable) e.preventDefault();

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

      const rect = container.getBoundingClientRect();
      const pointerMinutes = snapMinutes(
        yToMinutes(
          e.clientY + container.scrollTop - rect.top - getGridHeaderOffset(),
          hourHeight,
        ),
        settings.snapMinutes,
      );

      const dayDelta = dayIndex - state.originalDay;

      const overAllDay = isOverAllDay(e.clientY, rect);
      const entries = [
        {
          event: state.event,
          originalStart: state.originalStart,
          originalEnd: state.originalEnd,
          allDay: state.allDay,
        },
        ...(state.selection ?? []),
      ];
      const applyEntries = (
        apply: (en: (typeof entries)[number]) => boolean,
      ) => {
        let changed = false;
        for (const en of entries) changed = apply(en) || changed;
        state.x = e.clientX;
        state.y = e.clientY;
        showDragStep(state, {
          newStart: state.event.start,
          newEnd: state.event.end,
          changed,
        });
      };

      if (
        state.type === "move" &&
        (overAllDay || entries.some((en) => en.allDay || en.event.allDay))
      ) {
        applyEntries((en) => {
          const day = en.originalStart.plus({ days: dayDelta });
          const duration = en.originalEnd.diff(en.originalStart);
          if (overAllDay)
            return toAllDay(en.event, day, en.allDay ? duration : undefined);
          if (en.allDay)
            return toTimed(
              en.event,
              day.startOf("day").plus({ minutes: pointerMinutes }),
              { minutes: settings.defaultEventDuration },
            );
          return toTimed(en.event, day, duration);
        });
        return;
      }

      // calculate minutes based on pointer Y within the grid
      const deltaMinutes = snapMinutes(
        yToMinutes(e.clientY + container.scrollTop - state.startY, hourHeight),
        settings.snapMinutes,
      );

      if (state.type !== "move" && entries.some((en) => en.event.allDay)) {
        applyEntries((en) =>
          applyTimes(
            en.event,
            en.event.allDay
              ? resizeAllDay(
                  state.type,
                  en.originalStart,
                  en.originalEnd,
                  dayDelta,
                )
              : getDraggedTimes(
                  state.type,
                  en.originalStart,
                  en.originalEnd,
                  dayDelta,
                  deltaMinutes,
                  settings.snapMinutes,
                ),
          ),
        );
        return;
      }

      // when dragging, label tells the new start/end times and follows the pointer
      state.x = e.clientX;
      state.y = e.clientY;
      showDragStep(
        state,
        applyDragWithResize(
          state,
          dayDelta,
          deltaMinutes,
          settings.snapMinutes,
        ),
      );
    },
    [
      visibleDays,
      hourHeight,
      settings.snapMinutes,
      settings.defaultEventDuration,
      isOverAllDay,
      getGridHeaderOffset,
      showDragStep,
    ],
  );

  const pointerUpRef = useRef<(e: PointerEvent) => void>(null);
  const onGlobalPointerCancel = useCallback(
    (e: PointerEvent) => {
      if (dragRef.current?.pointerId !== e.pointerId) return;
      dragRef.current = null;
      setIsDragging(false);
      forceRender((tick) => tick + 1);
      window.removeEventListener("pointermove", onGlobalPointerMove);
      window.removeEventListener("pointerup", pointerUpRef.current!);
      window.removeEventListener("pointercancel", pointerCancelRef.current!);
      releaseTouchBlock();
    },
    [onGlobalPointerMove],
  );
  const pointerCancelRef = useRef(onGlobalPointerCancel);
  pointerCancelRef.current = onGlobalPointerCancel;

  const commitSelectionDrag = useCallback(
    (state: NonNullable<EventDragRef>) => {
      if (!state.moved) {
        dragRef.current = null;
        return;
      }

      pushHistory();

      const entries = [
        {
          event: state.event,
          originalStart: state.originalStart,
          originalEnd: state.originalEnd,
        },
        ...(state.selection ?? []),
      ].toSorted(
        (a, b) =>
          Number(isChainParent(a.event)) - Number(isChainParent(b.event)),
      );

      let detached = false;
      let working = calendarEventsRef.current;

      for (const entry of entries) {
        const moved = { ...entry.event, timestamp: Date.now() };

        if (!moved._parent && !moved.repeat) {
          dispatch({
            type: "update",
            id: moved.id,
            data: { start: moved.start, end: moved.end, allDay: moved.allDay },
          });

          updateChange({ type: "updated", event: moved });
        } else {
          const parent = detachSingleOccurrence(
            moved,
            entry.originalStart,
            working,
            dispatch,
            updateChange,
            settings.detachRecurringOnEdit,
          );

          if (parent) {
            working = working.map((e) => (e.id === parent.id ? parent : e));
          }

          detached = true;
        }
      }

      dragRef.current = null;
      if (detached) clearSelection();
      save();
    },
    [
      updateChange,
      dispatch,
      save,
      clearSelection,
      pushHistory,
      settings.detachRecurringOnEdit,
    ],
  );

  const commitSingleDrag = useCallback(
    (state: NonNullable<EventDragRef>) => {
      const event = state.event;
      const changed =
        !!event.allDay !== !!state.allDay ||
        event.start.toMillis() !== state.originalStart.toMillis() ||
        event.end.toMillis() !== state.originalEnd.toMillis();

      // update the edited event in state
      if (!event._parent && !event.repeat) {
        if (changed) {
          // creating a new event already pushed history in startNewEvent
          if (state.type !== "new") pushHistory();

          const newEvent = { ...event, timestamp: Date.now() };

          dispatch({
            type: "update",
            id: event.id,
            data: {
              start: newEvent.start,
              end: newEvent.end,
              allDay: newEvent.allDay,
            },
          });

          updateChange({
            type: "updated",
            event: newEvent,
          });
        }

        dragRef.current = null;
        save();
      } else if (state.moved && changed) {
        // if the event has or is a parent, ask what to do
        askUpdateScope(event, null);
      } else {
        // if it didn't actually update, just revert
        dragRef.current = null;
      }
    },
    [updateChange, dispatch, save, pushHistory, askUpdateScope],
  );

  const commitDrag = useCallback(
    (state: NonNullable<EventDragRef>) =>
      state.selection?.length
        ? commitSelectionDrag(state)
        : commitSingleDrag(state),
    [commitSelectionDrag, commitSingleDrag],
  );

  const onGlobalPointerUp = useCallback(
    (e: PointerEvent) => {
      // make sure the same pointer was released, then reset drag state and remove listeners
      if (dragRef.current?.pointerId === e.pointerId) {
        commitDrag(dragRef.current);

        setIsDragging(false);
        window.removeEventListener("pointermove", onGlobalPointerMove);
        window.removeEventListener("pointerup", onGlobalPointerUp);
        window.removeEventListener("pointercancel", onGlobalPointerCancel);
        releaseTouchBlock();
      }
    },
    [commitDrag, onGlobalPointerMove, onGlobalPointerCancel],
  );

  pointerUpRef.current = onGlobalPointerUp;

  const updateSelection = useCallback(
    (state: NonNullable<typeof selectionBoxRef.current>) => {
      const container = gridRef.current;
      if (!container) return;

      state.x1 = state.px + container.scrollLeft;
      state.y1 = state.py + container.scrollTop;

      state.moved ||=
        Math.abs(state.x1 - state.x0) > SELECT_DRAG_THRESHOLD ||
        Math.abs(state.y1 - state.y0) > SELECT_DRAG_THRESHOLD;

      if (state.moved) {
        const boxed = getEventsByKey(eventMapRef.current, getBoxedKeys(state));
        selectEvents([...state.base, ...boxed]);
      }

      forceRender((tick) => tick + 1);
    },
    [selectEvents],
  );

  const onSelectionPointerMove = useCallback(
    (e: PointerEvent) => {
      const state = selectionBoxRef.current;
      if (!state || e.pointerId !== state.pointerId) return;

      state.px = e.clientX;
      state.py = e.clientY;
      updateSelection(state);
    },
    [updateSelection],
  );

  const onSelectionPointerUp = useCallback(
    (e: PointerEvent) => {
      const state = selectionBoxRef.current;
      if (!state || e.pointerId !== state.pointerId) return;

      if (!state.moved && state.toggle) toggleSelection(state.toggle);

      selectionBoxRef.current = null;
      forceRender((tick) => tick + 1);

      window.removeEventListener("pointermove", onSelectionPointerMove);
      window.removeEventListener("pointerup", onSelectionPointerUp);
    },
    [onSelectionPointerMove, toggleSelection],
  );

  const beginSelectionBox = useCallback(
    (e: React.PointerEvent, toggle?: CalendarEvent) => {
      const container = gridRef.current;
      if (!container) return;

      const offsetX = container.scrollLeft;
      const offsetY = container.scrollTop;

      selectionBoxRef.current = {
        pointerId: e.pointerId,
        x0: e.clientX + offsetX,
        y0: e.clientY + offsetY,
        x1: e.clientX + offsetX,
        y1: e.clientY + offsetY,
        px: e.clientX,
        py: e.clientY,
        moved: false,
        toggle,
        base: Array.from(selectedEventsRef.current.values()),
        rects: getEventRects(offsetX, offsetY),
      };

      window.addEventListener("pointermove", onSelectionPointerMove);
      window.addEventListener("pointerup", onSelectionPointerUp);

      const scrollNearEdge = () => {
        const state = selectionBoxRef.current;
        if (!state) return;

        const rect = container.getBoundingClientRect();
        const speed = (pointer: number, min: number, max: number) => {
          const depth = Math.max(
            min + AUTO_SCROLL_ZONE - pointer,
            pointer - max + AUTO_SCROLL_ZONE,
          );
          const ease = clamp(depth / AUTO_SCROLL_ZONE, 0, 1) ** 2;
          return Math.round(
            AUTO_SCROLL_SPEED * ease * (pointer < (min + max) / 2 ? -1 : 1),
          );
        };
        const left = container.scrollLeft;
        const top = container.scrollTop;
        container.scrollLeft = clamp(
          left +
            speed(
              state.px,
              Math.max(rect.left, 0),
              Math.min(rect.right, window.innerWidth),
            ),
          0,
          container.scrollWidth - container.clientWidth,
        );
        container.scrollTop = clamp(
          top +
            speed(
              state.py,
              Math.max(rect.top, 0),
              Math.min(rect.bottom, window.innerHeight),
            ),
          0,
          container.scrollHeight - container.clientHeight,
        );
        if (container.scrollLeft !== left || container.scrollTop !== top) {
          // sticky blocks (all day strip) move relative to the content on scroll
          state.rects = getEventRects(
            container.scrollLeft,
            container.scrollTop,
          );
          updateSelection(state);
        }
        requestAnimationFrame(scrollNearEdge);
      };
      requestAnimationFrame(scrollNearEdge);
    },
    [onSelectionPointerMove, onSelectionPointerUp, updateSelection],
  );

  const getDragSelection = useCallback(
    (selected: Map<string, CalendarEvent>, key: string) =>
      selected.size > 1 && selected.has(key)
        ? resolveSelection(eventMapRef.current, selected, key).map((ev) => ({
            event: { ...ev },
            originalStart: ev.start,
            originalEnd: ev.end,
            allDay: ev.allDay,
          }))
        : undefined,
    [],
  );

  const onEventPointerDown = useCallback(
    (
      e: React.PointerEvent,
      type: "move" | "resize_start" | "resize_end",
      event: CalendarEvent,
      dayIndex: number,
    ) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const container = gridRef.current;
      if (!container) return;

      e.preventDefault();
      if (e.ctrlKey) {
        beginSelectionBox(e, event);
        return;
      }

      const selected = selectedEventsRef.current;
      const key = eventKey(event);
      if (selected.size > 0 && !selected.has(key)) {
        clearSelection();
      }

      const selection = getDragSelection(selected, key);

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
        allDay: event.allDay,
        label: "",
        dayRects: getDayRects(),
        moved: false,
        selection,
      };

      window.addEventListener("pointermove", onGlobalPointerMove);
      window.addEventListener("pointerup", onGlobalPointerUp);
      window.addEventListener("pointercancel", onGlobalPointerCancel);
      if (e.pointerType === "touch") {
        window.addEventListener("touchmove", blockTouchMove, {
          passive: false,
        });
        touchBlockTarget.current = e.target;
        e.target.addEventListener("touchmove", blockTouchMove, {
          passive: false,
        });
      }
    },

    // visibleDays is needed here for getDayRects to work
    // eslint-disable-next-line
    [
      visibleDays,
      onGlobalPointerMove,
      onGlobalPointerUp,
      onGlobalPointerCancel,
      beginSelectionBox,
      clearSelection,
      getDragSelection,
    ],
  );

  const beginKeyboardMove = useCallback(
    (event: CalendarEvent, dayIndex: number) => {
      const selected = selectedEventsRef.current;
      const key = eventKey(event);
      if (selected.size > 0 && !selected.has(key)) clearSelection();

      const selection = getDragSelection(selected, key);

      dragRef.current = {
        pointerId: KEYBOARD_DRAG_ID,
        type: "move",
        startY: 0,
        x: 0,
        y: 0,
        event: { ...event },
        originalDay: dayIndex,
        originalStart: event.start,
        originalEnd: event.end,
        label: describeDragLabel(event, selection?.length),
        dayRects: [],
        moved: false,
        selection,
      };
      setIsDragging(true);

      return 1 + (selection?.length ?? 0);
    },
    [clearSelection, getDragSelection],
  );

  const stepKeyboardMove = useCallback(
    (
      type: "move" | "resize_start" | "resize_end",
      dayDelta: number,
      deltaMinutes: number,
    ) => {
      const state = dragRef.current;
      if (state?.pointerId !== KEYBOARD_DRAG_ID) return null;

      state.type = type;

      const event = state.event;
      const lane = headerZoneRef.current > GRID_HEADER_HEIGHT;
      const enters =
        lane &&
        !event.allDay &&
        event.start.diff(event.start.startOf("day"), "minutes").minutes +
          deltaMinutes <
          0;
      const leaves = !!event.allDay && deltaMinutes > 0;

      if (enters || leaves) {
        let changed = false;
        for (const { event: ev } of [state, ...(state.selection ?? [])]) {
          if (enters && !ev.allDay) changed = toAllDay(ev, ev.start) || changed;
          if (leaves && ev.allDay) {
            changed =
              toTimed(ev, ev.start.startOf("day"), {
                minutes: settings.defaultEventDuration,
              }) || changed;
          }
        }
        showDragStep(state, {
          newStart: event.start,
          newEnd: event.end,
          changed,
        });
        return event;
      }
      if (event.allDay && deltaMinutes) return event;

      showDragStep(
        state,
        applyDragDelta(
          state,
          dayDelta,
          deltaMinutes,
          settings.snapMinutes,
          "current",
        ),
      );

      return state.event;
    },
    [settings.snapMinutes, settings.defaultEventDuration, showDragStep],
  );

  const cancelKeyboardMove = useCallback(() => {
    if (dragRef.current?.pointerId !== KEYBOARD_DRAG_ID) return;
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  const confirmKeyboardMove = useCallback(() => {
    const state = dragRef.current;
    if (state?.pointerId !== KEYBOARD_DRAG_ID) return "unchanged";

    const unchanged =
      isAtOriginal(state.event, state.originalStart, state.originalEnd) &&
      (state.selection ?? []).every((entry) =>
        isAtOriginal(entry.event, entry.originalStart, entry.originalEnd),
      );

    if (unchanged) {
      cancelKeyboardMove();
      return "unchanged";
    }

    commitDrag(state);
    setIsDragging(false);
    return dragRef.current ? "pending" : "moved";
  }, [commitDrag, cancelKeyboardMove]);

  const getBatch = useCallback((event: CalendarEvent) => {
    const selected = selectedEventsRef.current;
    const key = eventKey(event);
    if (selected.size < 2 || !selected.has(key)) return null;

    return [
      event,
      ...resolveSelection(eventMapRef.current, selected, key),
    ].toSorted((a, b) => Number(isChainParent(a)) - Number(isChainParent(b)));
  }, []);

  const onEventEdit = useCallback(
    (originalEvent: CalendarEvent, event: CalendarEvent) => {
      // nothing changed, so there's nothing to save
      if (eventUnchanged(originalEvent, event)) return;

      if (
        settings.addColorsAutomatically &&
        event.color &&
        settings.eventColorPresets.length < MAX_EVENT_COLOR_PRESETS &&
        !settings.eventColorPresets.some(
          (presetColor) =>
            presetColor.toLowerCase() === event.color!.toLowerCase(),
        )
      ) {
        settings.setSetting("eventColorPresets", [
          ...settings.eventColorPresets,
          event.color,
        ]);
      }

      const batch = getBatch(originalEvent);

      if (batch) {
        pushHistory();

        const originalKey = eventKey(originalEvent);
        const startDateChanged = !event.start.hasSame(
          originalEvent.start,
          "day",
        );
        const startTimeChanged =
          event.start.hour !== originalEvent.start.hour ||
          event.start.minute !== originalEvent.start.minute ||
          event.start.second !== originalEvent.start.second ||
          event.start.millisecond !== originalEvent.start.millisecond;
        const endDateChanged = !event.end.hasSame(originalEvent.end, "day");
        const endTimeChanged =
          event.end.hour !== originalEvent.end.hour ||
          event.end.minute !== originalEvent.end.minute ||
          event.end.second !== originalEvent.end.second ||
          event.end.millisecond !== originalEvent.end.millisecond;

        const patch: Partial<CalendarEvent> = {};
        if (event.title !== originalEvent.title) patch.title = event.title;
        if (event.description !== originalEvent.description) {
          patch.description = event.description;
        }
        if (event.color !== originalEvent.color) patch.color = event.color;
        if (repeatChanged(originalEvent.repeat, event.repeat)) {
          patch.repeat = event.repeat;
        }
        if (event.isTask !== originalEvent.isTask) patch.isTask = event.isTask;
        if (event.allDay !== originalEvent.allDay) patch.allDay = event.allDay;
        if (event.completed !== originalEvent.completed) {
          patch.completed = event.completed;
        }
        if (
          !sameNotifications(originalEvent.notifications, event.notifications)
        ) {
          patch.notifications = event.notifications;
        }

        let working = calendarEventsRef.current;

        for (const ev of batch) {
          const isEdited = eventKey(ev) === originalKey;

          const next = {
            ...ev,
            ...patch,
            start: isEdited
              ? event.start
              : applyBatchField(
                  ev.start,
                  event.start,
                  startDateChanged,
                  startTimeChanged,
                ),
            end: isEdited
              ? event.end
              : applyBatchField(
                  ev.end,
                  event.end,
                  endDateChanged,
                  endTimeChanged,
                ),
            timestamp: Date.now(),
          };

          if (ev._parent || ev.repeat) {
            const parent = detachSingleOccurrence(
              next,
              ev.start,
              working,
              dispatch,
              updateChange,
              settings.detachRecurringOnEdit ||
                (!!ev._parent && "repeat" in patch),
            );

            if (parent) {
              working = working.map((e) => (e.id === parent.id ? parent : e));
            }
          } else {
            dispatch({ type: "update", id: next.id, data: next });
            updateChange({ type: "updated", event: next });
          }
        }

        clearSelection();
        save();
        return;
      }

      const onlyCompletedChanged =
        event.completed !== originalEvent.completed &&
        eventUnchanged(originalEvent, {
          ...event,
          completed: originalEvent.completed,
        });

      if (
        onlyCompletedChanged &&
        (event._parent || (originalEvent.repeat && event.repeat))
      ) {
        const isParent = isChainParent(event);
        const parentId = isParent ? event.id : event._parent;
        const originalParent = calendarEventsRef.current.find(
          (e) => e.id === parentId,
        );

        if (originalParent?.repeat) {
          pushHistory();

          const dateKey = event.start.toISODate()!;
          const instances = originalParent.completedInstances ?? [];
          const parent = {
            ...originalParent,
            completedInstances: event.completed
              ? [...instances, dateKey]
              : instances.filter((d) => d !== dateKey),
            timestamp: Date.now(),
          };

          dispatch({ type: "update", id: parent.id, data: parent });
          updateChange({ type: "updated", event: parent });
          save();
          return;
        }
      }

      if (event._parent || (originalEvent.repeat && event.repeat)) {
        askUpdateScope(event, originalEvent);
        return;
      }

      const stoppedRepeating =
        originalEvent.repeat &&
        !event.repeat &&
        originalEvent.isTask &&
        originalEvent.completedInstances !== undefined;

      const startedRepeating =
        !originalEvent.repeat &&
        event.repeat &&
        event.isTask &&
        event.completed;

      const nextEvent = stoppedRepeating
        ? { ...event, completedInstances: undefined }
        : startedRepeating
          ? {
              ...event,
              completedInstances: [event.start.toISODate()!],
            }
          : event;

      pushHistory();

      dispatch({
        type: "update",
        id: nextEvent.id,
        data: nextEvent,
      });

      updateChange({
        id: nextEvent.id,
        type: "updated",
        event: nextEvent,
      });

      save();
    },
    [
      dispatch,
      updateChange,
      save,
      getBatch,
      clearSelection,
      pushHistory,
      settings,
      askUpdateScope,
    ],
  );

  const onEventMove = useCallback(
    (originalEvent: CalendarEvent, event: CalendarEvent) => {
      // nothing changed, so there's nothing to save
      if (eventUnchanged(originalEvent, event)) return;

      pushHistory();

      // moving an event always affects this occurrence only, never prompts
      detachSingleOccurrence(
        event,
        originalEvent.start,
        calendarEventsRef.current,
        dispatch,
        updateChange,
        settings.detachRecurringOnEdit,
      );

      save();
    },
    [dispatch, updateChange, save, pushHistory, settings.detachRecurringOnEdit],
  );

  const deleteSelectionBatch = useCallback(
    (batch: CalendarEvent[]) => {
      pushHistory();

      let working = calendarEventsRef.current;

      const parentsLast = batch.toSorted(
        (a, b) => Number(isChainParent(a)) - Number(isChainParent(b)),
      );

      for (const ev of parentsLast) {
        if (ev._parent || ev.repeat) {
          const parent = skipSingleOccurrence(
            ev,
            working,
            dispatch,
            updateChange,
          );

          if (parent) {
            working = working.map((e) => (e.id === parent.id ? parent : e));
          }
        } else {
          dispatch({ type: "delete", id: ev.id });
          updateChange({ id: ev.id, type: "deleted" });
        }
      }

      clearSelection();
      setEditingEvent(null);
      save();
    },
    [
      dispatch,
      updateChange,
      save,
      clearSelection,
      setEditingEvent,
      pushHistory,
    ],
  );

  const onEventDelete = useCallback(
    (event: CalendarEvent, ignoreSelection = false) => {
      const batch = ignoreSelection ? null : getBatch(event);

      if (batch) {
        deleteSelectionBatch(batch);
        return;
      }

      if (event._parent || event.repeat) {
        setDeleteRepeatDialogOpen(true);
        evPendingRef.current = { event, original: null };
        return;
      }

      pushHistory();

      dispatch({
        type: "delete",
        id: event.id,
      });

      updateChange({
        id: event.id,
        type: "deleted",
      });

      setEditingEvent(null);
      save();
    },
    [
      setDeleteRepeatDialogOpen,
      dispatch,
      updateChange,
      save,
      getBatch,
      deleteSelectionBatch,
      setEditingEvent,
      pushHistory,
    ],
  );

  const onEventReset = useCallback(
    (event: CalendarEvent) => {
      pushHistory();
      resetOccurrence(event, calendarEventsRef.current, dispatch, updateChange);
      setEditingEvent(null);
      save();
    },
    [dispatch, updateChange, setEditingEvent, save, pushHistory],
  );

  const onEventDetach = useCallback(
    (event: CalendarEvent) => {
      pushHistory();
      detachSingleOccurrence(
        event,
        event.start,
        calendarEventsRef.current,
        dispatch,
        updateChange,
      );
      setEditingEvent(null);
      save();
    },
    [dispatch, updateChange, setEditingEvent, save, pushHistory],
  );

  const onEventDuplicate = useCallback(
    (event: CalendarEvent) => {
      const batch = getBatch(event) ?? [event];

      pushHistory();

      const added: CalendarEvent[] = [];

      for (const ev of batch) {
        const newEvent = {
          ...ev,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        } as CalendarEvent;

        if (
          countEventsOnDay(
            [...calendarEventsRef.current, ...added],
            newEvent.start,
          ) >= MAX_EVENTS_PER_DAY
        ) {
          toast.error(t("calendar.dayLimit", { count: MAX_EVENTS_PER_DAY }));
          continue;
        }

        added.push(newEvent);

        delete newEvent._parent;
        delete newEvent._instanceId;
        delete newEvent.repeat;

        dispatch({
          type: "add",
          event: newEvent,
        });

        updateChange({
          type: "added",
          event: newEvent,
        });
      }

      if (batch.length > 1) clearSelection();

      setEditingEvent(null);
      save();
    },
    [
      t,
      dispatch,
      updateChange,
      setEditingEvent,
      save,
      getBatch,
      clearSelection,
      pushHistory,
    ],
  );

  // expose the handlers via context so other components can use them
  useEffect(() => {
    setEventHandlers({
      edit: onEventEdit,
      move: onEventMove,
      remove: onEventDelete,
      duplicate: onEventDuplicate,
      detach: onEventDetach,
      reset: onEventReset,
    });
  }, [
    onEventEdit,
    onEventMove,
    onEventDelete,
    onEventDuplicate,
    onEventDetach,
    onEventReset,
    setEventHandlers,
  ]);

  const copySelection = useCallback(() => {
    if (selectedEventsRef.current.size === 0) return;
    const selected = Array.from(selectedEventsRef.current.values());
    if (selected.length > MAX_CLIPBOARD_EVENTS)
      toast.warning(t("calendar.copyLimit", { count: MAX_CLIPBOARD_EVENTS }));
    clipboardRef.current = selected.slice(0, MAX_CLIPBOARD_EVENTS);
  }, [t]);

  const pasteAtPointer = useCallback(() => {
    const clipboard = clipboardRef.current;
    const pointer = gridPointerRef.current;
    const container = gridRef.current;
    if (clipboard.length === 0 || !pointer || !container) return;

    const targetRect = getDayRects().find(
      (d) => pointer.x >= d.rect.left && pointer.x <= d.rect.right,
    );
    const dayDate = targetRect ? visibleDays[targetRect.day]?.date : null;
    if (!dayDate) return;

    const rect = container.getBoundingClientRect();
    const y = pointer.y + container.scrollTop;
    const minutes = snapMinutes(
      yToMinutes(y - rect.top - getGridHeaderOffset(), hourHeight),
      settings.snapMinutes,
    );
    const anchorTime = dayDate.plus({ minutes });
    const overAllDay = isOverAllDay(pointer.y, rect);

    const anchorStart = clipboard.reduce(
      (min, ev) => (ev.start < min ? ev.start : min),
      clipboard[0].start,
    );

    pushHistory();

    const pasted: CalendarEvent[] = [];
    let skipped = false;

    for (const ev of clipboard) {
      const allDay = overAllDay || ev.allDay;
      const duration = ev.end.diff(ev.start);
      const newStart = allDay
        ? dayDate
            .startOf("day")
            .plus(
              ev.start.startOf("day").diff(anchorStart.startOf("day"), "days"),
            )
        : anchorTime.plus(ev.start.diff(anchorStart));

      const newEvent = {
        ...ev,
        id: crypto.randomUUID(),
        start: newStart,
        end: ev.allDay
          ? newStart.plus(duration)
          : allDay
            ? newStart.endOf("day")
            : newStart.plus(duration),
        allDay: allDay || undefined,
        timestamp: Date.now(),
      } as CalendarEvent;

      if (
        countEventsOnDay([...calendarEventsRef.current, ...pasted], newStart) >=
        MAX_EVENTS_PER_DAY
      ) {
        skipped = true;
        continue;
      }

      delete newEvent._parent;
      delete newEvent._instanceId;
      delete newEvent.repeat;

      pasted.push(newEvent);

      dispatch({ type: "add", event: newEvent });
      updateChange({ type: "added", event: newEvent });
    }

    if (skipped)
      toast.error(t("calendar.dayLimit", { count: MAX_EVENTS_PER_DAY }));
    selectEvents(pasted);
    save();
  }, [
    t,
    visibleDays,
    hourHeight,
    getGridHeaderOffset,
    isOverAllDay,
    settings.snapMinutes,
    dispatch,
    updateChange,
    save,
    selectEvents,
    pushHistory,
  ]);

  /* -------------------------------------------------------------------------- */

  const addNewEvent = useCallback(
    (start: DateTime, isTask: boolean, allDayEnd?: DateTime) => {
      if (
        countEventsOnDay(calendarEventsRef.current, start) >= MAX_EVENTS_PER_DAY
      ) {
        toast.error(t("calendar.dayLimit", { count: MAX_EVENTS_PER_DAY }));
        return;
      }

      const newEvent = {
        id: crypto.randomUUID(),
        title: isTask
          ? resolveDefaultName("defaultTaskName", settings.defaultTaskName)
          : resolveDefaultName("defaultEventName", settings.defaultEventName),
        color: settings.eventColorPresets[0] ?? EVENT_COLOR_FALLBACK,
        start,
        end:
          allDayEnd ?? start.plus({ minutes: settings.defaultEventDuration }),
        timestamp: Date.now(),
        isTask,
        allDay: allDayEnd ? true : undefined,
        notifications: settings.defaultEventNotifications.length
          ? settings.defaultEventNotifications
          : undefined,
      } as CalendarEvent;

      pushHistory();
      dispatch({ type: "add", event: newEvent });
      updateChange({ type: "added", event: newEvent });

      return newEvent;
    },
    [
      t,
      settings.defaultEventName,
      settings.defaultTaskName,
      settings.defaultEventDuration,
      settings.defaultEventNotifications,
      settings.eventColorPresets,
      dispatch,
      updateChange,
      pushHistory,
    ],
  );

  const addAllDayEvent = useCallback(
    (date: DateTime) =>
      addNewEvent(date.startOf("day"), false, date.endOf("day")),
    [addNewEvent],
  );

  const createEventAtSlot = useCallback(
    (dayIndex: number, minutes: number) => {
      clearSelection();

      const { date } = visibleDays[dayIndex];
      const newEvent =
        minutes < 0
          ? addAllDayEvent(date)
          : addNewEvent(date.plus({ minutes }), false);
      save();

      return newEvent;
    },
    [visibleDays, addNewEvent, addAllDayEvent, save, clearSelection],
  );

  const startNewEvent = useCallback(
    (e: React.PointerEvent, dayIndex: number) => {
      const container = gridRef.current;
      if (!container) return;

      e.preventDefault();

      if (e.ctrlKey) {
        beginSelectionBox(e);
        return;
      }

      clearSelection();

      const rect = container.getBoundingClientRect();
      const startY = e.clientY + container.scrollTop;

      const startMinutes = yToMinutes(
        startY - rect.top - getGridHeaderOffset(),
        hourHeight,
      );

      const start = visibleDays[dayIndex].date.plus({
        minutes: snapMinutes(startMinutes, settings.snapMinutes),
      });
      const newEvent = addNewEvent(start, e.altKey);
      if (!newEvent) return;

      if (e.pointerType !== "touch") {
        window.addEventListener("pointermove", onGlobalPointerMove);
        window.addEventListener("pointerup", onGlobalPointerUp);
        window.addEventListener("pointercancel", onGlobalPointerCancel);
        setIsDragging(true);

        dragRef.current = {
          pointerId: e.pointerId,
          type: "new",
          startY,
          x: e.clientX,
          y: e.clientY,
          event: newEvent,
          originalDay: dayIndex,
          originalStart: start,
          originalEnd: start,
          label: translate("calendar.newEvent"),
          dayRects: getDayRects(),
          moved: false,
        };
      } else {
        save();
      }
    },
    [
      hourHeight,
      getGridHeaderOffset,
      settings.snapMinutes,
      addNewEvent,
      save,
      visibleDays,
      onGlobalPointerMove,
      onGlobalPointerUp,
      onGlobalPointerCancel,
      beginSelectionBox,
      clearSelection,
    ],
  );

  const onResizeTouchMove = useCallback(
    (e: TouchEvent) => {
      const state = dragRef.current;
      const resize = state?.resize;
      const touch = resize?.touch;
      if (!state || !resize || !touch) return;
      const finger = Array.from(e.touches).find(
        (t) => t.identifier === touch.id,
      );
      if (!finger) return;

      resize[touch.side] =
        touch.base +
        snapMinutes(
          yToMinutes(finger.clientY - touch.y, hourHeightRef.current),
          settings.snapMinutes,
        );

      showDragStep(
        state,
        applyDragWithResize(
          state,
          state.dayDelta ?? 0,
          state.deltaMinutes ?? 0,
          settings.snapMinutes,
        ),
      );
    },
    [settings.snapMinutes, showDragStep],
  );

  const onResizeTouchEnd = useCallback(
    (e: TouchEvent) => {
      const resize = dragRef.current?.resize;
      const id = resize?.touch?.id;
      if (
        id !== undefined &&
        !Array.from(e.changedTouches).some((t) => t.identifier === id)
      )
        return;
      if (resize) resize.touch = undefined;
      window.removeEventListener("touchmove", onResizeTouchMove);
      window.removeEventListener("touchend", onResizeTouchEnd);
      window.removeEventListener("touchcancel", onResizeTouchEnd);
    },
    [onResizeTouchMove],
  );

  const gridTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const drag = dragRef.current;
      if (
        e.touches.length > 1 &&
        drag &&
        drag.pointerId !== KEYBOARD_DRAG_ID &&
        !evPendingRef.current
      ) {
        const finger = e.changedTouches[0];
        if (drag.type === "move" && !drag.resize?.touch) {
          const side = finger.clientY < drag.y ? "start" : "end";
          drag.resize ??= { start: 0, end: 0 };
          drag.resize.touch = {
            id: finger.identifier,
            side,
            y: finger.clientY,
            base: drag.resize[side],
          };
          window.addEventListener("touchmove", onResizeTouchMove);
          window.addEventListener("touchend", onResizeTouchEnd);
          window.addEventListener("touchcancel", onResizeTouchEnd);
        }
        return;
      }

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
    },
    [onResizeTouchMove, onResizeTouchEnd],
  );

  const gridTouchMove = useCallback((e: React.TouchEvent) => {
    if (gridTouchRef.current === null) return;

    // dragging an event must not count towards swipe/pinch gestures
    if (dragRef.current) {
      if (gridTouchRef.current.raf)
        cancelAnimationFrame(gridTouchRef.current.raf);
      gridTouchRef.current = null;
      forceRender((tick) => tick + 1);
      return;
    }

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
      forceRender((tick) => tick + 1),
    );
  }, []);

  const gridTouchEnd = useCallback(() => {
    if (gridTouchRef.current === null) return;

    if (
      gridTouchRef.current.delta &&
      Math.abs(gridTouchRef.current.delta.x) > 100
    ) {
      move(gridTouchRef.current.delta.x > 0 !== rtl ? 1 : -1);
    }

    gridTouchRef.current.distance = undefined;
    if (gridTouchRef.current.raf)
      cancelAnimationFrame(gridTouchRef.current.raf);

    gridTouchRef.current = null;
    forceRender((tick) => tick + 1);
  }, [move, rtl]);

  /* -------------------------------------------------------------------------- */

  // sync ref with state for zoom calculations
  useEffect(() => {
    hourHeightRef.current = hourHeight;
  }, [hourHeight]);

  // and calendar events
  useEffect(() => {
    calendarEventsRef.current = calendarEvents;
  }, [calendarEvents]);

  // events keep the zone and locale they were parsed in, so re-zone/re-locale them when either changes
  useEffect(() => {
    const tz = settings.defaultTimezone;
    const locale = i18n.language;
    const current = calendarEventsRef.current;
    if (
      current.every((e) => e.start.zoneName === tz && e.start.locale === locale)
    )
      return;

    dispatch({
      type: "set",
      events: current.map((e) => ({
        ...e,
        start: e.start.setZone(tz).setLocale(locale),
        end: e.end.setZone(tz).setLocale(locale),
      })),
    });
  }, [settings.defaultTimezone, i18n.language, dispatch]);

  useEffect(() => {
    setCurrentDate((d) =>
      d.locale === i18n.language ? d : d.setLocale(i18n.language),
    );
    setNow((d) =>
      d.locale === i18n.language ? d : d.setLocale(i18n.language),
    );
  }, [i18n.language, setCurrentDate]);

  // keyboard shortcuts: arrows, escape, delete, undo/redo, cut/copy/paste
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!shortcutsApply(e.target)) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        move(rtl ? 1 : -1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        move(rtl ? -1 : 1);
      } else if (e.key === "Escape" && editingEvent === null) {
        clearSelection();
      } else if (e.key === "Delete") {
        if (editingEvent) {
          e.preventDefault();
          onEventDelete(editingEvent, true);
        } else if (selectedEventsRef.current.size > 0) {
          e.preventDefault();
          deleteSelectionBatch(Array.from(selectedEventsRef.current.values()));
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "c") {
        if (selectedEventsRef.current.size > 0) {
          e.preventDefault();
          copySelection();
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === "x") {
        if (selectedEventsRef.current.size > 0) {
          e.preventDefault();
          copySelection();
          deleteSelectionBatch(Array.from(selectedEventsRef.current.values()));
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === "v") {
        if (clipboardRef.current.length > 0) {
          e.preventDefault();
          pasteAtPointer();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    move,
    rtl,
    editingEvent,
    clearSelection,
    onEventDelete,
    deleteSelectionBatch,
    undo,
    redo,
    copySelection,
    pasteAtPointer,
  ]);

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

  // re-zone explicitly, since the state holds a DateTime in the previous zone
  useEffect(() => {
    setNow(DateTime.now().setZone(settings.defaultTimezone));
  }, [settings.defaultTimezone]);

  const resyncSeqRef = useRef(0);

  const resync = useCallback(() => {
    if (!user || !masterKey || !bucketKey || user.type === "offline") return;

    const seq = ++resyncSeqRef.current;

    toast.promise(
      new Promise<void>((resolve, reject) => {
        syncEvents(user, masterKey, bucketKey, currentDate)
          .then((newEvents) => {
            if (seq === resyncSeqRef.current) {
              dispatch({
                type: "set",
                events: newEvents,
              });
            }

            resolve();
          })
          .catch(() => reject());
      }),
      {
        loading: translate("calendar.syncing"),
        error: translate("events.syncFailed"),
      },
    );
  }, [syncEvents, user, masterKey, bucketKey, currentDate, dispatch]);

  useEffect(() => {
    resyncRef.current = resync;
  }, [resync]);

  // resync calendar events periodically and on stream event
  useEffect(() => {
    if (!user || !masterKey || !bucketKey || user.type === "offline") return;

    const stopListening = onStream("sync", resync);

    const resyncInterval = setInterval(
      resync,
      settings.resyncIntervalMinutes * 60000,
    );
    return () => {
      clearInterval(resyncInterval);
      stopListening();
    };
  }, [resync, user, masterKey, bucketKey, settings.resyncIntervalMinutes]);

  const syncedWeekRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || !masterKey || !bucketKey || user.type === "offline") return;

    const week = weekLabel(currentDate);
    if (syncedWeekRef.current === null) {
      syncedWeekRef.current = week;
      return;
    }
    if (syncedWeekRef.current === week) return;

    const timeout = setTimeout(() => {
      syncedWeekRef.current = week;
      resync();
    }, 500);

    return () => clearTimeout(timeout);
  }, [currentDate, resync, user, masterKey, bucketKey]);

  // reset events when the defaults change
  useEffect(() => {
    dispatch({ type: "set", events });
  }, [events, dispatch]);

  useEffect(() => {
    clearSelection();
  }, [visibleDays, clearSelection]);

  // select and scroll to the search result after navigating
  useEffect(() => {
    const event = pendingScrollRef.current;
    const container = gridRef.current;
    if (!event || !container) return;

    pendingScrollRef.current = null;
    selectEvents([event]);

    const { top } = getEventPixelPosition(event, event.start, hourHeight);
    container.scrollTop = Math.max(0, top - container.clientHeight / 3);
  }, [currentDate, hourHeight, selectEvents]);

  /* -------------------------------------------------------------------------- */

  const dragEvent = dragRef.current?.moved ? dragRef.current?.event : null;
  const dragDerived = useMemo(() => {
    const state = dragRef.current;
    if (!dragEvent || !state) return NO_DRAG;

    const dragged = [dragEvent, ...(state.selection ?? []).map((s) => s.event)];

    return {
      exclude: dragged.map(eventKey),
      append: dragged.map(
        (ev) => ({ ...ev, repeat: undefined }) as CalendarEvent,
      ),
    };
    // non-idiomatic but necessary - refactor later
    // eslint-disable-next-line
  }, [dragEvent, renderTick]);

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

  eventMapRef.current = eventMap;

  const { timedMap, allDayMap } = useMemo(() => {
    const timed = new Map(eventMap);
    const allDay = new Map<string, CalendarEvent[]>();
    for (const [key, dayEvents] of eventMap) {
      if (!dayEvents.some((e) => e.allDay)) continue;
      timed.set(
        key,
        dayEvents.filter((e) => !e.allDay),
      );
      allDay.set(
        key,
        dayEvents.filter((e) => e.allDay),
      );
    }
    return { timedMap: timed, allDayMap: allDay };
  }, [eventMap]);

  const visibleKeys = useMemo(
    () => visibleDates.map((d) => d.toISODate()!),
    [visibleDates],
  );
  const allDayLayout = useMemo(
    () =>
      layoutBars(
        visibleKeys,
        allDayMap,
        Array.from(allDayMap.values()).flat().length,
      ),
    [visibleKeys, allDayMap],
  );
  const allDayTitles = useMemo(
    () => barSpans(allDayLayout, visibleKeys),
    [allDayLayout, visibleKeys],
  );
  const allDayRows = Math.max(
    0,
    ...Array.from(
      allDayLayout.values(),
      ({ slots }) => slots.findLastIndex(Boolean) + 1,
    ),
  );
  const allDayOverflows = allDayRows > ALL_DAY_MAX_ROWS;
  const visibleRows = allDayOverflows
    ? allDayExpanded
      ? allDayRows + 1
      : ALL_DAY_MAX_ROWS
    : allDayRows;
  const stripHeight = allDayRows
    ? Math.max(ALL_DAY_MIN_ROWS, visibleRows) * ALL_DAY_ROW_HEIGHT
    : 0;
  headerZoneRef.current = GRID_HEADER_HEIGHT + stripHeight;

  // open the strip while a dragged bar would hide behind the collapsed box
  useEffect(() => {
    const state = dragRef.current;
    if (!state) return;
    const hidden =
      allDayOverflows &&
      [state.event, ...(state.selection ?? []).map((s) => s.event)]
        .filter((ev) => ev.allDay)
        .some(
          (ev) =>
            (barRow(allDayLayout, eventKey(ev)) ?? 0) >= ALL_DAY_MAX_ROWS - 1,
        );
    if (hidden !== allDayExpanded && (hidden || autoExpanded.current)) {
      autoExpanded.current = hidden;
      setAllDayExpanded(hidden);
    }
  }, [allDayLayout, allDayOverflows, allDayExpanded]);

  // open the strip while keyboard focus is on an event of a day with a collapsed box
  const editing = !!editingEvent;
  useEffect(() => {
    const sync = () => {
      if (dragRef.current) return;
      const focus = focusStore.getFocus();
      const inBoxDay =
        (editing || focusStore.getKeyboardMode()) &&
        !!focus?.eventKey &&
        focus.minutes === ALL_DAY_SLOT &&
        allDayOverflows &&
        (allDayLayout.get(visibleKeys[focus.day])?.slots ?? []).some(
          (e, i) => e && i >= ALL_DAY_MAX_ROWS - 1,
        );
      if (inBoxDay && !allDayExpanded) {
        autoExpanded.current = true;
        setAllDayExpanded(true);
      } else if (!inBoxDay && autoExpanded.current) {
        autoExpanded.current = false;
        setAllDayExpanded(false);
      }
    };
    sync();
    const unsubscribe = focusStore.subscribe(sync);
    return () => {
      unsubscribe();
    };
  }, [
    focusStore,
    allDayLayout,
    allDayOverflows,
    allDayExpanded,
    visibleKeys,
    editing,
  ]);

  const openEvent = (event: CalendarEvent, day: number) => {
    if (stateTargets(viewing, event, day)) {
      setViewingEvent(null);
      setEditingEvent(event, day);
    } else {
      setViewingEvent(event, day);
    }
  };

  const {
    gridProps: gridKeyboardProps,
    restoreFocus,
    onDialogFocusReturned,
  } = useGridKeyboard({
    gridRef,
    store: focusStore,
    visibleDays,
    eventMap,
    mode,
    weekStartsOn,
    snapMins: settings.snapMinutes,
    rtl,
    hourHeight,
    headerHeight: headerZoneRef.current,
    allDayLane: stripHeight > 0,
    now,
    move,
    setCurrentDate,
    selectedEventsRef,
    selectEvents,
    toggleSelection,
    createEventAt: createEventAtSlot,
    openEvent,
    deleteEvent: onEventDelete,
    beginMove: beginKeyboardMove,
    stepMove: stepKeyboardMove,
    confirmMove: confirmKeyboardMove,
    cancelMove: cancelKeyboardMove,
    toggleCompleted: (event) =>
      onEventEdit(event, { ...event, completed: !event.completed }),
  });

  const selectionBox = (() => {
    const state = selectionBoxRef.current;
    const container = gridRef.current;
    if (!state || !container) return null;

    return {
      left: Math.min(state.x0, state.x1) - container.scrollLeft,
      top: Math.min(state.y0, state.y1) - container.scrollTop,
      width: Math.abs(state.x1 - state.x0),
      height: Math.abs(state.y1 - state.y0),
    };
  })();

  // build map of event styles
  const stylesMap = useMemo(() => {
    const map = new Map<string, Record<string, EventStyle>>();

    for (const d of visibleDays) {
      const key = d.date.toISODate();
      if (!key) continue;

      const events = timedMap.get(key);
      if (!events?.length) continue;

      map.set(key, getDayEventStyles(events, d.date, hourHeight));
    }

    return map;
  }, [visibleDays, timedMap, hourHeight]);

  // fallback day index for editingEvent when no explicit day was given (e.g. agenda click)
  const editingEventFirstDayIndex = useMemo(() => {
    if (!editingEvent) return null;
    const editingKey = eventKey(editingEvent);

    for (let i = 0; i < visibleDays.length; i++) {
      const key = visibleDays[i].date.toISODate();
      const events = key ? eventMap.get(key) : undefined;

      if (events?.some((e) => eventKey(e) === editingKey)) {
        return i;
      }
    }

    return null;
  }, [editingEvent, visibleDays, eventMap]);

  const editingAt = useMemo(
    () => ({
      event: editingEvent,
      day: editingEventDay ?? editingEventFirstDayIndex,
    }),
    [editingEvent, editingEventDay, editingEventFirstDayIndex],
  );

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

  const createAllDayEvent = useCallback(
    (e: React.MouseEvent<HTMLElement>, dayIndex: number) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const inBottomHalf = e.clientY - rect.top > rect.height / 2;
      if (inBottomHalf === headerBottom) return;

      createEventAtSlot(dayIndex, ALL_DAY_SLOT);
    },
    [headerBottom, createEventAtSlot],
  );

  const startAllDayEvent = useCallback(
    (e: React.PointerEvent, from: number) => {
      if (e.target !== e.currentTarget || e.button !== 0) return;

      if (e.ctrlKey) {
        beginSelectionBox(e);
        return;
      }

      clearSelection();
      const rects = getDayRects();
      const centerX = ({ rect }: (typeof rects)[number]) =>
        (rect.left + rect.right) / 2;
      const dayAt = (x: number) =>
        rects.reduce((a, b) =>
          Math.abs(x - centerX(b)) < Math.abs(x - centerX(a)) ? b : a,
        ).day;
      const span = (to: number) => ({
        start: visibleDays[Math.min(from, to)].date.startOf("day"),
        end: visibleDays[Math.max(from, to)].date.endOf("day"),
      });

      const created = addAllDayEvent(visibleDays[from].date);
      if (!created) return;
      let last = from;

      const onMove = (ev: PointerEvent) => {
        const to = dayAt(ev.clientX);
        if (to === last) return;
        last = to;
        dispatch({ type: "update", id: created.id, data: span(to) });
      };
      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        updateChange({ type: "updated", event: { ...created, ...span(last) } });
        save();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [
      visibleDays,
      addAllDayEvent,
      dispatch,
      updateChange,
      save,
      clearSelection,
      beginSelectionBox,
    ],
  );

  const renderEvent = useCallback(
    (
      event: CalendarEvent,
      dayIndex: number,
      date: DateTime,
      style: EventStyle,
      titleSpan?: number,
    ) => (
      <EventBlock
        key={eventKey(event)}
        event={event}
        day={dayIndex}
        date={date}
        style={style}
        titleSpan={titleSpan}
        editing={stateTargets(editingAt, event, dayIndex)}
        viewing={stateTargets(viewing, event, dayIndex)}
        selection={selection}
        focusStore={focusStore}
        restoreFocus={restoreFocus}
        onPointerDown={onEventPointerDown}
        onEventEdit={onEventEdit}
        onEventMove={onEventMove}
        onEventDelete={onEventDelete}
        onDuplicate={onEventDuplicate}
        onDetach={onEventDetach}
        onReset={onEventReset}
        setEditingEvent={setEditingEvent}
        setViewingEvent={setViewingEvent}
      />
    ),
    [
      editingAt,
      viewing,
      selection,
      focusStore,
      restoreFocus,
      onEventPointerDown,
      onEventEdit,
      onEventMove,
      onEventDelete,
      onEventDuplicate,
      onEventDetach,
      onEventReset,
      setEditingEvent,
      setViewingEvent,
    ],
  );

  // headers in day/week view, one for every visibleDay
  const dayWeekHeaders = useMemo(() => {
    const cells = visibleDays.map((d, dayIndex) => (
      <HeaderCell
        key={dayIndex}
        onClick={(e) => createAllDayEvent(e, dayIndex)}
        className={cn(
          "select-none",
          headerBottom && "top-auto bottom-0",
          stripHeight > 0 && !headerBottom && NO_BOTTOM_BORDER,
          isSameDate(d.date, now) && "bg-card font-bold",
        )}
        aria-label={
          describeFullDay(d.date) +
          (isSameDate(d.date, now) ? `, ${t("a11y.today")}` : "")
        }
      >
        {d.label}
      </HeaderCell>
    ));
    return rtl ? cells.toReversed() : cells;
  }, [visibleDays, now, headerBottom, t, rtl, createAllDayEvent, stripHeight]);

  const tzColWidth = useMemo(
    () => getTimezoneColWidth(settings.timezones, visibleDays.length),
    [settings.timezones, visibleDays.length],
  );

  const tzStickyStyle = useCallback(
    (i: number) =>
      labelsRight
        ? {
            right: `calc(${tzColWidth} * ${settings.timezones.length - 1 - i})`,
          }
        : { left: `calc(${tzColWidth} * ${i})` },
    [labelsRight, tzColWidth, settings.timezones.length],
  );

  const timezoneHeaderCells = useMemo(
    () =>
      settings.timezones.map((tz, i) => (
        <TimezoneHeaderCell
          key={tz}
          tz={tz}
          multi={settings.timezones.length > 1}
          headerBottom={headerBottom}
          labelsRight={labelsRight}
          style={tzStickyStyle(i)}
        />
      )),
    [settings.timezones, headerBottom, labelsRight, tzStickyStyle],
  );

  const allDayRow = useMemo(() => {
    if (!stripHeight) return null;
    const edge = { [headerBottom ? "bottom" : "top"]: GRID_HEADER_HEIGHT };
    const rowHeight = stripHeight / visibleRows;
    const cells = visibleDays.map((d, dayIndex) => {
      const slots = allDayLayout.get(d.date.toISODate()!)?.slots ?? [];
      const capped = allDayOverflows && !allDayExpanded;
      const hidden = capped
        ? slots.slice(ALL_DAY_MAX_ROWS - 1).filter(Boolean).length
        : 0;
      const titleSpan = (event: CalendarEvent) => {
        const title = allDayTitles.get(barKey(event)!);
        return title?.day === dayIndex ? title.span : undefined;
      };
      const spanning = slots.some((e) => e && (titleSpan(e) ?? 0) > 1);
      const boxOnTop = headerBottom && allDayOverflows ? 1 : 0;
      const hasBox =
        allDayOverflows && slots.some((e, i) => e && i >= ALL_DAY_MAX_ROWS - 1);

      return (
        <div
          key={dayIndex}
          role="gridcell"
          className={cn(
            ALL_DAY_CELL,
            headerBottom && NO_BOTTOM_BORDER,
            spanning && "z-17",
          )}
          style={edge}
          onPointerDown={(e) => startAllDayEvent(e, dayIndex)}
        >
          <SlotIndicator
            store={focusStore}
            day={dayIndex}
            date={d.date}
            isToday={isSameDate(d.date, now)}
            events={allDayMap.get(d.date.toISODate()!) ?? []}
            hourHeight={hourHeight}
            snapMins={settings.snapMinutes}
            allDay
          />
          {slots.map(
            (event, i) =>
              event &&
              (!capped || i < ALL_DAY_MAX_ROWS - 1) &&
              renderEvent(
                event,
                dayIndex,
                d.date,
                {
                  top: (i + boxOnTop) * rowHeight,
                  height: rowHeight,
                  left: 0,
                  width: 100,
                },
                titleSpan(event),
              ),
          )}
          {hasBox && (
            <button
              type="button"
              aria-label={t(
                capped ? "calendar.expandAllDay" : "calendar.collapseAllDay",
              )}
              className="absolute inset-x-0 z-10 flex cursor-pointer items-center justify-center gap-0.5 text-xs text-muted-foreground hover:bg-accent"
              style={{
                top: boxOnTop
                  ? 0
                  : (capped ? ALL_DAY_MAX_ROWS - 1 : allDayRows) * rowHeight,
                height: rowHeight,
              }}
              onClick={() => {
                autoExpanded.current = false;
                setAllDayExpanded(capped);
              }}
            >
              {capped && `+${hidden}`}
              {capped !== headerBottom ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronUp className="size-3" />
              )}
            </button>
          )}
        </div>
      );
    });
    const tzCount = settings.timezones.length;
    const labelIndex = labelsRight ? 0 : tzCount - 1;
    const labels = settings.timezones.map((tz, i) => (
      <div
        key={tz}
        role="rowheader"
        className={cn(
          ALL_DAY_CELL,
          "flex items-center text-xs text-muted-foreground px-1",
          tzCount === 1 && "justify-center",
          tzCount > 1 &&
            (labelsRight ? "justify-start ps-2" : "justify-end pe-2"),
          i < tzCount - 1 && BOTTOM_BORDER_ONLY,
        )}
        style={{ ...edge, ...tzStickyStyle(i) }}
      >
        {i === labelIndex && (
          <span className="truncate">{t("editor.allDay")}</span>
        )}
      </div>
    ));
    return (
      <div role="row" className="contents">
        {!labelsRight && labels}
        {rtl ? cells.toReversed() : cells}
        {labelsRight && labels}
      </div>
    );
  }, [
    stripHeight,
    allDayOverflows,
    allDayExpanded,
    allDayLayout,
    allDayTitles,
    allDayRows,
    visibleRows,
    startAllDayEvent,
    headerBottom,
    visibleDays,
    allDayMap,
    focusStore,
    now,
    hourHeight,
    settings.snapMinutes,
    renderEvent,
    settings.timezones,
    tzStickyStyle,
    labelsRight,
    rtl,
    t,
  ]);

  const headerRow = labelsRight ? (
    <div role="row" className="contents">
      {dayWeekHeaders}
      {timezoneHeaderCells}
    </div>
  ) : (
    <div role="row" className="contents">
      {timezoneHeaderCells}
      {dayWeekHeaders}
    </div>
  );

  // hour labels don't depend on events, so event changes reuse these elements
  const hourLabels = useMemo(
    () =>
      HOURS.map((_label, hour) => (
        <>
          {settings.timezones.map((tz, i) => (
            <div
              key={tz}
              role="rowheader"
              dir={i18n.dir()}
              className={cn(
                "select-none sticky z-5 shadow-[inset_-1px_-1px_0_0_color-mix(in_srgb,var(--foreground)_calc(var(--line-opacity)*1%),transparent)] flex text-sm items-center justify-center",
                tz === settings.timezones[0] && hour == now.hour
                  ? "bg-card font-bold"
                  : "bg-background",
              )}
              style={tzStickyStyle(i)}
            >
              {getTimezoneHourLabel(
                visibleDays[0]?.date ?? currentDate,
                hour,
                tz,
              )}
            </div>
          ))}
        </>
      )),
    [
      settings.timezones,
      now.hour,
      tzStickyStyle,
      visibleDays,
      currentDate,
      i18n,
    ],
  );

  const dateRange = useMemo(
    () => getDateRangeString(mode, currentDate, weekStartsOn),
    // eslint-disable-next-line
    [mode, currentDate, weekStartsOn, t],
  );

  // grid in day/week view
  const timeGrid = useMemo(
    () =>
      HOURS.map((_label, hour) => {
        const timeLabels = hourLabels[hour];

        return (
          <div key={hour} role="row" className="contents">
            {!labelsRight && timeLabels}

            {(rtl ? visibleDays.toReversed() : visibleDays).map((d) => {
              const dayIndex = visibleDays.indexOf(d);
              const key = d.date.toISODate()!;
              const dayEvents = timedMap.get(key) || [];
              const styles = stylesMap.get(key) || {};

              return (
                <GridCell
                  key={`${dayIndex}-${hour}`}
                  day={dayIndex}
                  onCellTap={startNewEvent}
                >
                  {hour === 0 && (
                    <div className="pointer-events-none relative h-full">
                      <div
                        className="pointer-events-none"
                        style={{ height: hourHeight * 24 }}
                      />

                      {/* current time indicator line */}
                      {isSameDate(d.date, now) && (
                        <div
                          aria-hidden="true"
                          className={cn(
                            "pointer-events-none absolute left-0 right-0 z-15 shadow-xl bg-foreground before:absolute before:top-1/2 before:h-2 before:w-2 before:-translate-y-1/2 before:rounded-full before:bg-foreground",
                            // eslint-disable-next-line
                            rtl ? "before:-right-1" : "before:-left-1",
                          )}
                          style={{
                            top: getNowY(),
                            height: 2,
                          }}
                        />
                      )}

                      <SpokenMessage store={focusStore} day={dayIndex} />

                      <SlotIndicator
                        store={focusStore}
                        day={dayIndex}
                        date={d.date}
                        isToday={isSameDate(d.date, now)}
                        events={dayEvents}
                        hourHeight={hourHeight}
                        snapMins={settings.snapMinutes}
                      />

                      {/* today's events */}
                      {dayEvents.map((event) =>
                        renderEvent(
                          event,
                          dayIndex,
                          d.date,
                          styles[eventKey(event)] ?? styles[event.id],
                        ),
                      )}
                    </div>
                  )}
                </GridCell>
              );
            })}

            {labelsRight && timeLabels}
          </div>
        );
      }),
    [
      timedMap,
      stylesMap,
      visibleDays,
      now,
      getNowY,
      hourHeight,
      renderEvent,
      startNewEvent,
      focusStore,
      settings.snapMinutes,
      hourLabels,
      labelsRight,
      rtl,
    ],
  );

  return (
    <main className="flex h-screen w-full flex-col">
      {swipeDelta !== 0 && (
        <div
          className={cn(
            "fixed top-1/2 z-100 text-background border p-1 rounded",
            Math.abs(swipeDelta) >= 100 ? "bg-foreground" : "bg-foreground/50",
          )}
          style={{
            [swipeDelta > 0 ? "right" : "left"]: "-80px",
            transform: `translateX(${clamp(-swipeDelta, -100, 100)}px)`,
          }}
        >
          {swipeDelta > 0 ? <ArrowRight /> : <ArrowLeft />}
        </div>
      )}
      <nav className="relative flex items-center justify-between border-b p-3">
        {isMobile && <SidebarTrigger />}

        <div className="items-center gap-2 hidden md:flex">
          <Button variant="outline" onClick={goToToday}>
            {t("calendar.today")}
          </Button>
          <Button
            data-testid="prev-btn"
            variant="outline"
            size="icon"
            aria-label={t("calendar.previous")}
            onClick={() => move(-1)}
          >
            {rtl ? <ArrowRight /> : <ArrowLeft />}
          </Button>
          <Button
            data-testid="next-btn"
            variant="outline"
            size="icon"
            aria-label={t("calendar.next")}
            onClick={() => move(1)}
          >
            {rtl ? <ArrowLeft /> : <ArrowRight />}
          </Button>
          <h2 className="ms-2 text-xl">{dateRange}</h2>
        </div>

        <h2 className="flex-1 text-xl ms-6 md:hidden">{dateRange}</h2>

        <ModeSwitcher mode={mode} setMode={setMode} />

        <Popover
          open={isMobile ? searchOpen : searchOpen && searchQuery.length > 0}
          onOpenChange={setSearchOpen}
        >
          <PopoverAnchor asChild>
            {isMobile ? (
              <button
                ref={(el) => {
                  searchAnchorRef.current = el;
                }}
                type="button"
                aria-label={t("calendar.searchEvents")}
                onClick={() => setSearchOpen(!searchOpen)}
              >
                <SearchIcon />
              </button>
            ) : (
              <div
                ref={(el) => {
                  searchAnchorRef.current = el;
                }}
                className="flex items-center gap-2"
              >
                <SearchIcon />
                <div className="relative flex items-center">
                  <Input
                    ref={searchInputRef}
                    className="pe-8"
                    placeholder={t("calendar.searchPlaceholder")}
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSearchOpen(true);
                    }}
                    onFocus={() =>
                      searchQuery.length > 0 && setSearchOpen(true)
                    }
                  />
                  {searchQuery.length > 0 && (
                    <button
                      type="button"
                      aria-label={t("calendar.clearSearch")}
                      className="text-muted-foreground hover:text-foreground absolute inset-e-2"
                      onClick={() => {
                        setSearchQuery("");
                        searchInputRef.current?.focus();
                      }}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </PopoverAnchor>
          <PopoverContent
            align="end"
            className={isMobile ? "w-[calc(100vw-1.5rem)] p-2" : "w-80 p-1"}
            onOpenAutoFocus={(e) => {
              if (!isMobile) e.preventDefault();
            }}
            onInteractOutside={(e) => {
              if (searchAnchorRef.current?.contains(e.target as Node)) {
                e.preventDefault();
              }
            }}
          >
            {isMobile && (
              <div className="relative mb-2 flex items-center">
                <Input
                  ref={searchInputRef}
                  className="pe-8"
                  placeholder={t("calendar.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery.length > 0 && (
                  <button
                    type="button"
                    aria-label={t("calendar.clearSearch")}
                    className="text-muted-foreground hover:text-foreground absolute inset-e-2"
                    onClick={() => {
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            )}
            {searchResults.length === 0 ? (
              <p className="text-muted-foreground p-2 text-sm">
                {isSearchExpanding
                  ? t("calendar.searching")
                  : t("calendar.noMatches")}
              </p>
            ) : (
              <ul className="max-h-80 overflow-auto">
                {searchResults.map((ev) => (
                  <li key={eventKey(ev)}>
                    <button
                      type="button"
                      className="hover:bg-accent flex w-full items-stretch gap-2 rounded-sm p-2 text-start text-sm"
                      onClick={() => onSelectSearchResult(ev)}
                    >
                      <span
                        className="w-1 shrink-0 rounded-full"
                        style={{
                          backgroundColor: ev.color ?? EVENT_COLOR_FALLBACK,
                        }}
                      />
                      <span className="flex flex-col items-start">
                        <span className="font-medium">{ev.title}</span>
                        <span className="text-muted-foreground text-xs">
                          {ev.start.toFormat(fmt("dateTimeLong"))}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!isSearchExpanding && canExpandSearchRadius && (
              <div className="p-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={expandSearchRadius}
                >
                  {t("calendar.expandSearch")}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </nav>

      <div dir="ltr" className="@container flex-1 overflow-hidden relative">
        <div
          ref={gridRef}
          role="grid"
          aria-label={t("calendar.grid")}
          {...gridKeyboardProps}
          data-keyboard-mode={keyboardMode ? "" : undefined}
          className="group/grid outline-none touch-pan-y grid h-full overflow-auto calendar-grid-scroll"
          style={{
            ...({ "--line-opacity": settings.lineOpacity } as CSSProperties),
            gridTemplateColumns: cols(
              settings.timezones.length,
              tzColWidth,
              labelsRight,
            ),
            gridTemplateRows: rows(hourHeight, headerBottom, stripHeight),
          }}
          onTouchStart={gridTouchStart}
          onTouchMove={gridTouchMove}
          onTouchEnd={gridTouchEnd}
          onPointerMove={(e) => {
            gridPointerRef.current = { x: e.clientX, y: e.clientY };
          }}
        >
          {!headerBottom && headerRow}
          {!headerBottom && allDayRow}
          {timeGrid}
          {headerBottom && allDayRow}
          {headerBottom && headerRow}

          {isDragging && (
            <DragOverlay
              move={move}
              dragRef={dragRef}
              anchored={dragRef.current?.pointerId === KEYBOARD_DRAG_ID}
            />
          )}

          {selectionBox && (
            <div
              aria-hidden="true"
              className="selection-box fixed z-20 pointer-events-none border border-primary bg-primary/20"
              style={selectionBox}
            />
          )}
        </div>

        <ScrollThumb
          gridRef={gridRef}
          hourHeight={hourHeight}
          mode={mode}
          visibleDays={visibleDays}
        />
      </div>

      {isMobile && (
        <UndoRedoButtons
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
        />
      )}

      <RecurringUpdateDialog
        action="Update"
        defaultOption="this"
        open={updateRepeatDialogOpen}
        setOpen={setUpdateRepeatDialogOpen}
        onFocusReturned={onDialogFocusReturned}
        canKeepChanges={canKeepChanges}
        onSubmit={(option: string, keepChanges: boolean) => {
          const pending = evPendingRef.current;

          if (!pending) {
            toast.error(t("calendar.eventGone"));
            dragRef.current = null;
            evPendingRef.current = null;
            setUpdateRepeatDialogOpen(false);
            return;
          }

          const { event } = pending;
          const original = pending.original ?? event;

          pushHistory();

          const isParent = !event._parent && event.repeat;
          const parent = isParent
            ? event
            : calendarEvents.find((e) => e.id === event._parent);

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

            dragRef.current = null;
            evPendingRef.current = null;
            save();

            return;
          }

          const evStart = dragRef.current
            ? dragRef.current.originalStart
            : original.start;

          const evEnd = dragRef.current
            ? dragRef.current.originalEnd
            : original.end;

          switch (option) {
            case "this": {
              detachSingleOccurrence(
                event,
                evStart,
                calendarEvents,
                dispatch,
                updateChange,
                settings.detachRecurringOnEdit ||
                  (!isParent && repeatChanged(original.repeat, event.repeat)),
              );
              break;
            }

            case "future": {
              if (isParent) {
                // update everything
                const updated = withShiftedOverrides(original, event);

                dispatch({
                  type: "update",
                  id: parent.id,
                  data: updated,
                });

                updateChange({
                  type: "updated",
                  event: updated,
                });

                break;
              }

              const { created, remaining } = splitSeries(
                parent,
                event,
                keepChanges,
              );

              dispatch({ type: "add", event: created });
              updateChange({ type: "added", event: created });

              if (!remaining) {
                endSeriesBefore(parent, event, dispatch, updateChange);
                break;
              }

              updateChange({ type: "updated", event: remaining });
              dispatch({ type: "update", id: remaining.id, data: remaining });
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
              const startDayOffset = evStart
                .startOf("day")
                .diff(event.start.startOf("day"), "days").days;
              const endDayOffset = evEnd
                .startOf("day")
                .diff(event.end.startOf("day"), "days").days;

              const newEvent = {
                ...event,
                start: parent.start.minus({ days: startDayOffset }).set({
                  hour: event.start.hour,
                  minute: event.start.minute,
                }),
                end: parent.end.minus({ days: endDayOffset }).set({
                  hour: event.end.hour,
                  minute: event.end.minute,
                }),
                id: parent.id,
              };

              delete newEvent._parent;

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
          evPendingRef.current = null;
          save();
        }}
        onCancel={() => {
          dragRef.current = null;
          evPendingRef.current = null;
        }}
      />

      <RecurringUpdateDialog
        action="Delete"
        defaultOption="this"
        open={deleteRepeatDialogOpen}
        setOpen={setDeleteRepeatDialogOpen}
        onFocusReturned={onDialogFocusReturned}
        onSubmit={(option: string) => {
          const event = evPendingRef.current?.event;

          if (!event) {
            toast.error(t("calendar.eventGone"));
            evPendingRef.current = null;
            setDeleteRepeatDialogOpen(false);
            return;
          }

          pushHistory();

          const isParent = !event._parent && event.repeat;
          const parent = isParent
            ? event
            : calendarEvents.find((e) => e.id === event._parent);

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

            setEditingEvent(null);
            save();
            return;
          }

          switch (option) {
            case "this": {
              skipSingleOccurrence(
                event,
                calendarEvents,
                dispatch,
                updateChange,
              );
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
              if (endSeriesBefore(parent, event, dispatch, updateChange)) break;

              // end parent's repetition
              parent.repeat.until = cutPoint(parent, event).toMillis();
              parent.repeat.overrides = overridesBefore(parent, event);

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

          evPendingRef.current = null;
          setEditingEvent(null);
          save();
        }}
        onCancel={() => {
          evPendingRef.current = null;
        }}
      />
    </main>
  );
});
