import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { DateTime } from "luxon";
import type { CalendarEvent } from "@/types/calendar/Event";
import { describeSlot, describeWhen } from "@/lib/calendar/a11y";
import { getWeekDays, isSameDate } from "@/lib/calendar/date";
import { eventKey } from "@/lib/calendar/event";
import {
  ALL_DAY_SLOT,
  MINUTES_PER_DAY,
  eventDomId,
  clampSlot,
  slotWithinDay,
  adjacentEvent,
  eventsAtSlot,
  moveFocus,
  moveStepForKey,
  type GridFocus,
  type GridFocusStore,
} from "@/lib/calendar/gridFocus";
import { t } from "@/i18n";

type Day = { date: DateTime; label: string };

type Params = {
  gridRef: RefObject<HTMLDivElement | null>;
  store: GridFocusStore;
  visibleDays: Day[];
  eventMap: Map<string, CalendarEvent[]>;
  mode: string;
  weekStartsOn: number;
  snapMins: number;
  rtl: boolean;
  hourHeight: number;
  headerHeight: number;
  allDayLane: boolean;
  now: DateTime;
  move: (steps: number) => void;
  setCurrentDate: (date: DateTime) => void;
  selectedEventsRef: RefObject<Map<string, CalendarEvent>>;
  selectEvents: (events: CalendarEvent[]) => void;
  toggleSelection: (event: CalendarEvent) => void;
  createEventAt: (dayIndex: number, minutes: number) => CalendarEvent;
  openEvent: (event: CalendarEvent, day: number) => void;
  deleteEvent: (event: CalendarEvent) => void;
  toggleCompleted: (event: CalendarEvent) => void;
  beginMove: (event: CalendarEvent, day: number) => number;
  stepMove: (
    type: "move" | "resize_start" | "resize_end",
    dayDelta: number,
    deltaMinutes: number,
  ) => CalendarEvent | null;
  confirmMove: () => "moved" | "pending" | "unchanged";
  cancelMove: () => void;
};

type MoveSession = {
  title: string;
  key: string;
  count: number;
  origin: GridFocus;
  last: CalendarEvent;
};

type KeyContext = {
  e: React.KeyboardEvent;
  p: Params;
  focus: GridFocus;
  date: DateTime;
  atSlot: CalendarEvent[];
  focused: CalendarEvent | undefined;
  handled: () => void;
};

const NATIVE_MENU_WINDOW_MS = 500;

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollRangeIntoView(
  container: HTMLElement,
  startMinutes: number,
  endMinutes: number,
  direction: 1 | -1,
  { hourHeight, headerHeight }: Pick<Params, "hourHeight" | "headerHeight">,
) {
  const top = (startMinutes / 60) * hourHeight;
  const bottom = (endMinutes / 60) * hourHeight;
  const visibleBottom =
    container.scrollTop + container.clientHeight - headerHeight;

  const toTop = top < container.scrollTop ? top : null;
  const toBottom =
    bottom > visibleBottom
      ? bottom - visibleBottom + container.scrollTop
      : null;
  const target = direction > 0 ? (toBottom ?? toTop) : (toTop ?? toBottom);
  if (target === null) return;

  container.scrollTo({
    top: target,
    behavior: prefersReducedMotion() ? "instant" : "smooth",
  });
}

export default function useGridKeyboard(params: Params) {
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // only Tab switches back from "pointer", so keys pressed in a mouse-opened menu don't count
  const focusSource = useRef<"keyboard" | "pointer">("keyboard");

  const moving = useRef<MoveSession | null>(null);

  const syncDescendant = useCallback((next: GridFocus) => {
    const { gridRef, visibleDays, eventMap, store } = paramsRef.current;
    if (store.getSpoken()) return;

    const day = visibleDays[next.day];
    const event =
      next.eventKey && day
        ? eventMap
            .get(day.date.toISODate()!)
            ?.find((e) => eventKey(e) === next.eventKey)
        : null;

    if (event)
      gridRef.current?.setAttribute(
        "aria-activedescendant",
        eventDomId(event, next.day),
      );
  }, []);

  const commit = useCallback(
    (next: GridFocus) => {
      const { store } = paramsRef.current;
      if (!moving.current) store.clearSpoken();
      store.setFocus(next);
      syncDescendant(next);
    },
    [syncDescendant],
  );

  // screen readers only reliably speak a change of the active descendant
  const speak = useCallback((text: string, day?: number) => {
    const { store } = paramsRef.current;
    store.setSpoken(day ?? store.getFocus()?.day ?? 0, text);
  }, []);

  const endMove = useCallback(() => {
    const { store } = paramsRef.current;
    store.clearSpoken();
    const focus = store.getFocus();
    if (focus) syncDescendant(focus);
  }, [syncDescendant]);

  const abandonMove = useCallback(
    (message?: string) => {
      const session = moving.current;
      if (!session) return;
      moving.current = null;
      paramsRef.current.cancelMove();
      endMove();
      commit(session.origin);
      if (message) speak(message);
    },
    [commit, endMove, speak],
  );

  const setKeyboardMode = useCallback(
    (on: boolean) => {
      if (!on) abandonMove();
      paramsRef.current.store.setKeyboardMode(on);
      if (!on)
        paramsRef.current.gridRef.current?.removeAttribute(
          "aria-activedescendant",
        );
    },
    [abandonMove],
  );

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      focusSource.current = "pointer";
      abandonMove();
      const grid = paramsRef.current.gridRef.current;
      if (e.target instanceof Node && grid?.contains(e.target))
        setKeyboardMode(false);
    };
    const onTab = (e: KeyboardEvent) => {
      if (e.key === "Tab") focusSource.current = "keyboard";
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onTab, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onTab, true);
    };
  }, [setKeyboardMode, abandonMove]);

  const describeFocusedSlot = useCallback(
    (focus: GridFocus, date: DateTime) => {
      const { eventMap, now, snapMins } = paramsRef.current;
      const titles = eventsAtSlot(
        eventMap.get(date.toISODate()!),
        date,
        focus.minutes,
        snapMins,
      ).map((e) => e.title);

      return describeSlot(date, focus.minutes, isSameDate(date, now), titles);
    },
    [],
  );

  const show = useCallback(
    (focus: GridFocus, span?: { endMinutes: number; direction: 1 | -1 }) => {
      const p = paramsRef.current;
      if (p.gridRef.current)
        scrollRangeIntoView(
          p.gridRef.current,
          focus.minutes,
          span?.endMinutes ?? focus.minutes + p.snapMins,
          span?.direction ?? -1,
          p,
        );
    },
    [],
  );

  const initialFocus = useCallback((): GridFocus => {
    const { visibleDays, now, gridRef, hourHeight, snapMins } =
      paramsRef.current;
    const today = visibleDays.findIndex((d) => isSameDate(d.date, now));

    return {
      day: Math.max(today, 0),
      minutes:
        today >= 0
          ? slotWithinDay(now, now, snapMins)
          : clampSlot(
              ((gridRef.current?.scrollTop ?? 0) / hourHeight) * 60,
              snapMins,
            ),
      eventKey: null,
    };
  }, []);

  const onFocus = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      const on =
        focusSource.current === "keyboard" &&
        e.currentTarget.matches(":focus-visible");
      setKeyboardMode(on);
      if (!on) return;

      const focus = paramsRef.current.store.getFocus() ?? initialFocus();
      commit(focus);
      show(focus);
    },
    [initialFocus, commit, show, setKeyboardMode],
  );

  const onBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) setKeyboardMode(false);
    },
    [setKeyboardMode],
  );

  const handleMoveKey = useCallback(
    (e: React.KeyboardEvent, focus: GridFocus, date: DateTime) => {
      const p = paramsRef.current;
      const session = moving.current!;
      const swallow = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (e.key === "Tab") {
        abandonMove();
        return;
      }

      if (e.key === "Escape") {
        swallow();
        abandonMove(t("keyboard.moveCancelled"));
        return;
      }

      if (e.key === "Enter" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        swallow();
        const result = p.confirmMove();
        moving.current = null;

        if (result === "moved") {
          speak(
            session.count > 1
              ? t("keyboard.movedMany", { count: session.count })
              : t("keyboard.moved", {
                  title: session.title,
                  when: describeWhen(session.last),
                }),
          );
          return;
        }

        endMove();
        if (result === "unchanged") {
          commit(session.origin);
          speak(t("keyboard.moveCancelled"));
        }
        return;
      }

      const step = moveStepForKey(e, p.snapMins, p.rtl);

      if (!step) {
        if (!e.ctrlKey && !e.altKey && !e.metaKey) swallow();
        else e.stopPropagation();
        return;
      }
      swallow();

      const updated = p.stepMove(step.type, step.days, step.minutes);
      if (!updated) return;
      session.last = updated;

      const dayCount = p.visibleDays.length;
      const startOfDay = updated.start.startOf("day");
      let day =
        focus.day +
        Math.round(startOfDay.diff(date.startOf("day"), "days").days);
      let shift: -1 | 0 | 1 = 0;

      if (day < 0) {
        day += dayCount;
        shift = -1;
      } else if (day > dayCount - 1) {
        day -= dayCount;
        shift = 1;
      }
      if (shift) p.move(shift);

      const next = {
        day,
        minutes: updated.allDay
          ? ALL_DAY_SLOT
          : slotWithinDay(updated.start, updated.start, p.snapMins),
        eventKey: session.key,
      };
      commit(next);
      speak(describeWhen(updated), day);
      show(next, {
        endMinutes: updated.allDay
          ? 0
          : Math.min(
              MINUTES_PER_DAY,
              updated.end.diff(startOfDay, "minutes").minutes,
            ),
        direction: step.minutes > 0 ? 1 : -1,
      });
    },
    [abandonMove, endMove, commit, show, speak],
  );

  const ownMenuEvent = useRef<Event | null>(null);
  const nativeMenuBlockedUntil = useRef(0);

  // the browser raises its own menu for the key too, at a moment and target we don't control
  useEffect(() => {
    const blockNative = (e: Event) => {
      if (
        e !== ownMenuEvent.current &&
        performance.now() < nativeMenuBlockedUntil.current
      )
        e.preventDefault();
    };

    window.addEventListener("contextmenu", blockNative, true);
    return () => window.removeEventListener("contextmenu", blockNative, true);
  }, []);

  // the menu listens on the event block, but keyboard focus stays on the grid
  const openContextMenu = useCallback((event: CalendarEvent, day: number) => {
    const block = document.getElementById(eventDomId(event, day));
    if (!block) return;

    const rect = block.getBoundingClientRect();
    ownMenuEvent.current = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + Math.min(rect.height, 32) / 2,
    });
    nativeMenuBlockedUntil.current = performance.now() + NATIVE_MENU_WINDOW_MS;

    block.dispatchEvent(ownMenuEvent.current);
  }, []);

  // some platforms raise the native menu on key up, after the key down was handled
  const onContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (
      e.target === e.currentTarget &&
      paramsRef.current.store.getKeyboardMode()
    )
      e.preventDefault();
  }, []);

  const goToNow = useCallback(
    ({ p }: KeyContext) => {
      const today = p.visibleDays.findIndex((d) => isSameDate(d.date, p.now));
      let day = today;
      if (today < 0) {
        day =
          p.mode === "week"
            ? getWeekDays(p.now, p.weekStartsOn).findIndex((d) =>
                isSameDate(d.date, p.now),
              )
            : 0;
        p.setCurrentDate(p.now);
      }
      const next = {
        day,
        minutes: slotWithinDay(p.now, p.now, p.snapMins),
        eventKey: null,
      };
      commit(next);
      show(next);
    },
    [commit, show],
  );

  const toggleFocusedCompleted = useCallback(
    ({ p, focused, handled }: KeyContext) => {
      if (!focused?.isTask) return;
      handled();
      p.toggleCompleted(focused);
      speak(
        t(focused.completed ? "keyboard.notCompleted" : "keyboard.completed", {
          title: focused.title,
        }),
      );
    },
    [speak],
  );

  const jumpToAdjacentEvent = useCallback(
    ({ e, p, focus, handled }: KeyContext) => {
      handled();
      const direction = e.key === "ArrowDown" ? 1 : -1;
      const next = adjacentEvent(
        p.visibleDays.map((d) => ({
          date: d.date,
          events: p.eventMap.get(d.date.toISODate()!),
        })),
        focus,
        direction,
        p.snapMins,
      );

      if (next) {
        commit(next);
        show(next);
      } else {
        speak(t(direction > 0 ? "keyboard.noLater" : "keyboard.noEarlier"));
      }
    },
    [commit, show, speak],
  );

  const navigate = useCallback(
    (
      { e, p, focus, date, atSlot, focused, handled }: KeyContext,
      target: NonNullable<ReturnType<typeof moveFocus>>,
    ) => {
      handled();

      const next: GridFocus = {
        day: target.day,
        minutes: target.minutes,
        eventKey: null,
      };
      const nextDate =
        target.dayShift === 0
          ? p.visibleDays[target.day].date
          : date.plus({ days: target.dayShift });

      if (target.dayShift !== 0) p.move(target.dayShift);

      let suffix = "";
      if (e.shiftKey) {
        const entered =
          target.dayShift === 0
            ? eventsAtSlot(
                p.eventMap.get(nextDate.toISODate()!),
                nextDate,
                next.minutes,
                p.snapMins,
              )
            : [];
        const leaving = focused ? [focused] : atSlot;
        const all = [
          ...(p.selectedEventsRef.current?.values() ?? []),
          ...leaving,
          ...entered,
        ];
        p.selectEvents(all);
        const size = new Set(all.map(eventKey)).size;
        suffix =
          size > 0 ? `, ${t("keyboard.selectedCount", { count: size })}` : "";
      }

      commit(next);
      show(next);
      const stayed =
        !focus.eventKey &&
        next.day === focus.day &&
        next.minutes === focus.minutes;
      if (suffix || stayed) speak(describeFocusedSlot(next, nextDate) + suffix);
    },
    [commit, show, speak, describeFocusedSlot],
  );

  const cycleEventsAtSlot = useCallback(
    ({ e, focus, atSlot, handled }: KeyContext) => {
      const index = atSlot.findIndex((ev) => eventKey(ev) === focus.eventKey);
      const neighbour = atSlot[index + (e.shiftKey ? -1 : 1)];
      if (!neighbour) return;
      handled();
      commit({ ...focus, eventKey: eventKey(neighbour) });
    },
    [commit],
  );

  const activate = useCallback(
    ({ p, focus, date, atSlot, focused, handled }: KeyContext) => {
      handled();
      if (focused) {
        p.openEvent(focused, focus.day);
      } else if (atSlot.length > 0) {
        commit({ ...focus, eventKey: eventKey(atSlot[0]) });
      } else {
        const created = p.createEventAt(focus.day, focus.minutes);
        speak(
          t("keyboard.created", {
            title: created.title,
            slot: describeSlot(
              date,
              focus.minutes,
              isSameDate(date, p.now),
              [],
            ),
          }),
        );
      }
    },
    [commit, speak],
  );

  const startMove = useCallback(
    ({ p, focus, focused, handled }: KeyContext) => {
      if (!focused) return;
      handled();
      const count = p.beginMove(focused, focus.day);
      moving.current = {
        title: focused.title,
        key: eventKey(focused),
        count,
        origin: focus,
        last: focused,
      };
      speak(
        t(count > 1 ? "keyboard.movingMore" : "keyboard.moving", {
          title: focused.title,
          count: count - 1,
        }),
      );
    },
    [speak],
  );

  const toggleFocusedSelected = useCallback(
    ({ p, focused, handled }: KeyContext) => {
      handled();
      if (!focused) return;
      const selected = p.selectedEventsRef.current?.has(eventKey(focused));
      p.toggleSelection(focused);
      speak(
        t(selected ? "keyboard.deselected" : "keyboard.selected", {
          title: focused.title,
        }),
      );
    },
    [speak],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const p = paramsRef.current;
      if (e.target !== e.currentTarget || !p.store.getKeyboardMode()) return;
      if ((e.altKey || e.metaKey) && !moving.current) return;

      const focus = p.store.getFocus() ?? initialFocus();
      const date = p.visibleDays[focus.day]?.date;
      if (!date) return;

      if (moving.current) {
        handleMoveKey(e, focus, date);
        return;
      }

      const dayEvents = p.eventMap.get(date.toISODate()!);
      const ctx: KeyContext = {
        e,
        p,
        focus,
        date,
        atSlot: eventsAtSlot(dayEvents, date, focus.minutes, p.snapMins),
        focused: focus.eventKey
          ? dayEvents?.find((ev) => eventKey(ev) === focus.eventKey)
          : undefined,
        handled: () => {
          e.preventDefault();
          e.stopPropagation();
        },
      };
      const { focused } = ctx;

      if (
        focused &&
        (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))
      ) {
        ctx.handled();
        openContextMenu(focused, focus.day);
        return;
      }

      if (e.ctrlKey) {
        const plainCtrl = !e.shiftKey && !e.altKey && !e.metaKey;
        if (e.key === "Home") {
          ctx.handled();
          goToNow(ctx);
        } else if (e.key === "Enter") {
          toggleFocusedCompleted(ctx);
        } else if (
          plainCtrl &&
          (e.key === "ArrowUp" || e.key === "ArrowDown")
        ) {
          jumpToAdjacentEvent(ctx);
        }
        return;
      }

      const target = moveFocus(focus, e.key, {
        snapMins: p.snapMins,
        dayCount: p.visibleDays.length,
        rtl: p.rtl,
        allDayLane: p.allDayLane,
      });
      if (target) {
        navigate(ctx, target);
      } else if (e.key === "Tab" && focused) {
        cycleEventsAtSlot(ctx);
      } else if (e.key === "Enter") {
        activate(ctx);
      } else if (e.key === "m" || e.key === "M") {
        startMove(ctx);
      } else if (e.key === " ") {
        toggleFocusedSelected(ctx);
      } else if (
        e.key === "Delete" &&
        focused &&
        !p.selectedEventsRef.current?.size
      ) {
        ctx.handled();
        p.deleteEvent(focused);
      }
    },
    [
      initialFocus,
      handleMoveKey,
      openContextMenu,
      goToNow,
      toggleFocusedCompleted,
      jumpToAdjacentEvent,
      navigate,
      cycleEventsAtSlot,
      activate,
      startMove,
      toggleFocusedSelected,
    ],
  );

  const { visibleDays, eventMap, allDayLane } = params;
  useEffect(() => {
    const { store } = paramsRef.current;
    const focus = store.getFocus();
    if (!focus) return;

    const day = Math.min(focus.day, visibleDays.length - 1);
    const minutes = allDayLane ? focus.minutes : Math.max(focus.minutes, 0);
    const key = visibleDays[day]?.date.toISODate();
    const keep =
      focus.eventKey &&
      key &&
      eventMap.get(key)?.some((ev) => eventKey(ev) === focus.eventKey);
    if (
      day === focus.day &&
      minutes === focus.minutes &&
      (keep || !focus.eventKey)
    ) {
      if (keep) syncDescendant(focus);
      return;
    }

    commit({
      day,
      minutes,
      eventKey: keep ? focus.eventKey : null,
    });
  }, [visibleDays, eventMap, allDayLane, commit, syncDescendant]);

  const restoreNow = useCallback(
    (opener: Element | null, event: CalendarEvent, day: number) => {
      const { gridRef, store, visibleDays, snapMins } = paramsRef.current;
      const grid = gridRef.current;
      if (!grid) return;

      if (
        opener instanceof HTMLElement &&
        opener.isConnected &&
        !grid.contains(opener)
      ) {
        opener.focus({ preventScroll: true });
        return;
      }

      const current = store.getFocus();
      const date = visibleDays[day]?.date;
      const minutes =
        current?.day === day
          ? current.minutes
          : event.allDay
            ? ALL_DAY_SLOT
            : date
              ? slotWithinDay(event.start, date, snapMins)
              : 0;
      const next = { day, minutes, eventKey: eventKey(event) };

      commit(next);
      grid.focus({ preventScroll: true });
      setKeyboardMode(true);
      show(next);
    },
    [commit, show, setKeyboardMode],
  );

  const deferredRestore = useRef<(() => void) | null>(null);

  // a dialog that is still open traps focus, so it hands it back once it closes
  const restoreFocus = useCallback(
    (opener: Element | null, event: CalendarEvent, day: number) => {
      if (document.querySelector("[data-recurring-dialog]"))
        deferredRestore.current = () => restoreNow(opener, event, day);
      else restoreNow(opener, event, day);
    },
    [restoreNow],
  );

  const onDialogFocusReturned = useCallback((toOpener: boolean) => {
    const restore = deferredRestore.current;
    deferredRestore.current = null;
    if (!toOpener) restore?.();
  }, []);

  return {
    gridProps: { tabIndex: 0, onFocus, onBlur, onKeyDown, onContextMenu },
    restoreFocus,
    onDialogFocusReturned,
  };
}
