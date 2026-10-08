import { cn, isColorDark, shallowEqual } from "@/lib/utils";
import { eventKey } from "@/lib/calendar/event";
import {
  EVENT_COLOR_FALLBACK,
  useCalendarSettings,
} from "@/context/CalendarSettingsContext";
import type { EventClickAction } from "@/types/calendar/Settings";
import type { EventBlockProps } from "@/types/calendar/Props";
import { useRef, memo, useMemo, useCallback, useEffect, useState } from "react";
import EventEditor from "./EventEditor";
import EventDetails from "./EventDetails";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { RedoDot } from "lucide-react";
import useTapInteraction from "@/hooks/useTapInteraction";
import { useIsMobile } from "@/hooks/use-mobile";
import { EventMenuItems } from "./EventMenuItems";
import { Checkbox } from "../ui/checkbox";
import { describeEvent } from "@/lib/calendar/a11y";
import { timeFormat } from "@/lib/calendar/date";
import { fmt } from "@/i18n";
import { eventDomId } from "@/lib/calendar/gridFocus";
import { useEventFocused } from "@/hooks/useGridFocus";
import { useEventSelected } from "@/hooks/useSelection";
import { useTranslation } from "react-i18next";

// how long (ms) a touch must be held roughly still before it starts a drag
const LONG_PRESS_MS = 450;
// how far (px) a touch may move during the hold before it's treated as a scroll/tap instead
const LONG_PRESS_TOLERANCE = 10;

const DOUBLE_CLICK_MS = 250;

const ALL_DAY_PADDING_REM = 0.5;

const SELECTED_SHADOW = "inset 0 0 0 1px var(--foreground)";

export default memo(
  function EventBlock({
    event,
    day,
    date,
    style,
    titleSpan,
    editing,
    viewing,
    selection,
    focusStore,
    restoreFocus,
    onPointerDown,
    onEventEdit,
    onEventMove,
    onEventDelete,
    onDuplicate,
    onDetach,
    onReset,
    setEditingEvent,
    setViewingEvent,
  }: EventBlockProps) {
    const { t, i18n } = useTranslation();
    const isMobile = useIsMobile();
    const keyboardFocused = useEventFocused(focusStore, eventKey(event), day);
    const selected = useEventSelected(selection, eventKey(event));

    const { startsToday, endsToday } = useMemo(
      () => ({
        startsToday: event.start.day === date.day,
        endsToday: event.end.day === date.day,
      }),
      [event.start, event.end, date],
    );

    const { eventColor, textColor, startTimeFormat, endTimeFormat } =
      useMemo(() => {
        const color = event.color ?? EVENT_COLOR_FALLBACK;
        const isDark = isColorDark(color);
        const sameMeridiem =
          event.start.toFormat("a") === event.end.toFormat("a");
        return {
          eventColor: color,
          textColor: isDark ? "text-white" : "text-black",
          startTimeFormat: timeFormat(event.start, !sameMeridiem || !endsToday),
          endTimeFormat:
            timeFormat(event.end) + (endsToday ? "" : fmt("dayAbbrevSuffix")),
        };
        // eslint-disable-next-line
      }, [event.start, event.end, event.color, endsToday, t]);

    const lineHeight = 16;
    const isTiny = style.height < lineHeight;
    const [isPoppedOut, setIsPoppedOut] = useState(false);
    const popOut = isTiny && isPoppedOut;
    const popOutHeight = lineHeight * 2;

    const DRAG_MOVE_THRESHOLD = 5;

    const popOutTimerRef = useRef<number | null>(null);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    const mouseDownRef = useRef(false);
    const clickTimerRef = useRef<number>(undefined);

    const clearPopOutTimer = useCallback(() => {
      if (popOutTimerRef.current !== null) {
        window.clearTimeout(popOutTimerRef.current);
        popOutTimerRef.current = null;
      }
    }, []);

    const collapsePopOut = useCallback(() => {
      clearPopOutTimer();
      setIsPoppedOut(false);
    }, [clearPopOutTimer]);

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent) => {
        if (!isTiny || e.buttons !== 0) return;
        clearPopOutTimer();
        popOutTimerRef.current = window.setTimeout(() => {
          setIsPoppedOut(true);
        }, 150);
      },
      [isTiny, clearPopOutTimer],
    );
    const handleMouseLeave = useCallback(() => {
      collapsePopOut();
    }, [collapsePopOut]);

    useEffect(() => {
      const handlePointerMove = (e: PointerEvent) => {
        const start = dragStartRef.current;
        if (!start) return;

        if (
          Math.abs(e.clientX - start.x) > DRAG_MOVE_THRESHOLD ||
          Math.abs(e.clientY - start.y) > DRAG_MOVE_THRESHOLD
        ) {
          dragStartRef.current = null;
          mouseDownRef.current = false;
          collapsePopOut();
          setViewingEvent(null);
        }
      };
      const handlePointerUp = () => {
        dragStartRef.current = null;
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      return () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
      };
    }, [collapsePopOut, setViewingEvent]);

    useEffect(() => clearPopOutTimer, [clearPopOutTimer]);
    useEffect(() => () => window.clearTimeout(clickTimerRef.current), []);

    const rtl = i18n.dir() === "rtl";
    const connectedShadow = useMemo(() => {
      if (!event.allDay || event.start.hasSame(event.end, "day")) return;
      return [
        "inset 0 1px 0 0 rgba(0,0,0,0.35)",
        "inset 0 -1px 0 0 rgba(0,0,0,0.35)",
        startsToday && `inset ${rtl ? -1 : 1}px 0 0 0 rgba(0,0,0,0.35)`,
        endsToday && `inset ${rtl ? 1 : -1}px 0 0 0 rgba(0,0,0,0.35)`,
      ]
        .filter(Boolean)
        .join(",");
    }, [event.allDay, event.start, event.end, startsToday, endsToday, rtl]);

    const spanning = !!event.allDay && (titleSpan ?? 0) > 1;
    const titleStyle = useMemo(() => {
      if (!spanning) return undefined;
      const rem = (titleSpan! - 1) * ALL_DAY_PADDING_REM;
      return {
        width: `calc(${titleSpan! * 100}% + ${rem}rem)`,
        marginLeft: rtl
          ? `calc(-${(titleSpan! - 1) * 100}% - ${rem}rem)`
          : undefined,
      };
    }, [spanning, titleSpan, rtl]);

    const blockStyle = useMemo(
      () => ({
        top: style.top,
        left: style.left + "%",
        // stop mobile browsers from popping up their own text-selection/
        // context-menu callout on the long-press used for hold-to-drag
        WebkitTouchCallout: "none" as const,
        WebkitUserSelect: "none" as const,
        touchAction: "pan-y" as const,
        height: popOut ? popOutHeight : style.height,
        width: style.width + "%",
        backgroundColor: eventColor,
        boxShadow: selected ? SELECTED_SHADOW : connectedShadow,
        contain: popOut || spanning ? undefined : ("paint" as const),
        overflow: spanning ? ("visible" as const) : undefined,
      }),
      [
        style.top,
        style.left,
        style.height,
        style.width,
        eventColor,
        selected,
        connectedShadow,
        spanning,
        popOut,
        popOutHeight,
      ],
    );

    const blockRef = useRef<HTMLDivElement>(null);
    const padding =
      event.allDay || style.height > lineHeight * 3 ? "p-1" : "p-px"; // TODO: maybe make it smarter in the future
    const lineClamp = useMemo(
      () => Math.ceil((popOut ? popOutHeight : style.height) / lineHeight) - 2,
      [style.height, popOut, popOutHeight],
    );
    const timeLabel = useMemo(
      () =>
        `${event.start.toFormat(startTimeFormat)} - ${event.end.toFormat(endTimeFormat)}`,
      [event.start, event.end, startTimeFormat, endTimeFormat],
    );

    const settings = useCalendarSettings((s) => ({
      click: s.eventClickAction,
      doubleClick: s.eventDoubleClickAction,
    }));

    const runAction = (action: EventClickAction) => {
      if (action === "details") {
        setViewingEvent(event, day);
      } else if (action === "edit") {
        setViewingEvent(null);
        setEditingEvent(event, day);
      }
    };

    const { handlers: tapHandlers } = useTapInteraction({
      onTap: () => setTimeout(() => runAction(settings.click), 50),
    });

    const handleClick = (e: React.MouseEvent) => {
      const pressed = mouseDownRef.current;
      mouseDownRef.current = false;
      if (!pressed || e.ctrlKey) return;
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = window.setTimeout(
        () => runAction(settings.click),
        settings.doubleClick === "none" ? 0 : DOUBLE_CLICK_MS,
      );
    };

    const handleDelete = useCallback(() => {
      onEventDelete(event);
    }, [onEventDelete, event]);

    const preventTouch = useCallback((e: React.PointerEvent) => {
      if (e.pointerType === "touch") e.preventDefault();
    }, []);

    // hold-to-drag support for touch screens: a touch must be held roughly
    // still for LONG_PRESS_MS before it's treated as the start of a drag,
    // otherwise it's left alone so tapping/scrolling keeps working normally
    const [isHeld, setIsHeld] = useState(false);
    const longPressRef = useRef<{
      timer: number;
      x: number;
      y: number;
      pointerId: number;
      activated: boolean;
    } | null>(null);

    const cancelLongPress = useCallback(() => {
      if (longPressRef.current) {
        window.clearTimeout(longPressRef.current.timer);
        longPressRef.current = null;
      }
      setIsHeld(false);
    }, []);

    useEffect(() => cancelLongPress, [cancelLongPress]);

    useEffect(() => {
      const release = (e: PointerEvent) => {
        if (longPressRef.current?.pointerId === e.pointerId) cancelLongPress();
      };
      const cancelOnMultiTouch = (e: TouchEvent) => {
        if (e.touches.length > 1) cancelLongPress();
      };
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
      window.addEventListener("touchstart", cancelOnMultiTouch, {
        passive: true,
      });
      return () => {
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
        window.removeEventListener("touchstart", cancelOnMultiTouch);
      };
    }, [cancelLongPress]);

    const handleTouchPointerDown = useCallback(
      (e: React.PointerEvent) => {
        tapHandlers.onPointerDown(e);

        const timer = window.setTimeout(() => {
          const state = longPressRef.current;
          if (!state) return;
          state.activated = true;
          setIsHeld(true);
          collapsePopOut();
          setViewingEvent(null);
          navigator.vibrate?.(15);
          onPointerDown(e, "move", event, day);
        }, LONG_PRESS_MS);

        longPressRef.current = {
          timer,
          x: e.clientX,
          y: e.clientY,
          pointerId: e.pointerId,
          activated: false,
        };
      },
      [tapHandlers, onPointerDown, event, day, collapsePopOut, setViewingEvent],
    );

    const handleTouchPointerMove = useCallback(
      (e: React.PointerEvent) => {
        tapHandlers.onPointerMove(e);

        const state = longPressRef.current;
        if (!state || state.activated || state.pointerId !== e.pointerId)
          return;

        // moved too far before the hold finished, treat this as a scroll/tap
        if (
          Math.abs(e.clientX - state.x) > LONG_PRESS_TOLERANCE ||
          Math.abs(e.clientY - state.y) > LONG_PRESS_TOLERANCE
        ) {
          cancelLongPress();
        }
      },
      [tapHandlers, cancelLongPress],
    );

    const handleTouchPointerUp = useCallback(
      (e: React.PointerEvent) => {
        // if the drag never activated, this was a normal tap release
        if (!longPressRef.current?.activated) tapHandlers.onPointerUp(e);
        cancelLongPress();
      },
      [tapHandlers, cancelLongPress],
    );

    const handleTouchPointerCancel = useCallback(
      (e: React.PointerEvent) => {
        tapHandlers.onPointerCancel(e);
        cancelLongPress();
      },
      [tapHandlers, cancelLongPress],
    );

    const stopPropagation = useCallback((e: React.PointerEvent) => {
      e.stopPropagation();
    }, []);

    const duplicate = useCallback(() => {
      onDuplicate(event);
    }, [event, onDuplicate]);

    const detach = useCallback(() => {
      onDetach(event);
    }, [event, onDetach]);

    const reset = useCallback(() => {
      onReset(event);
    }, [event, onReset]);

    const toggleCompleted = useCallback(
      (checked: boolean) => {
        onEventEdit(event, { ...event, completed: checked });
      },
      [event, onEventEdit],
    );

    return (
      <>
        <ContextMenu>
          {/* long-press-to-open conflicts with hold-to-drag on touch, so the
              context menu is only available on mobile via the "..." button
              inside the event editor */}
          <ContextMenuTrigger onPointerDown={preventTouch} disabled={isMobile}>
            {/* visible event block */}
            {/* not focusable on purpose, keyboard focus belongs to the grid */}
            {/* eslint-disable-next-line */}
            <div
              className={cn(
                "pointer-events-auto event-block absolute left-0 right-0 z-10 text-xs cursor-pointer select-none overflow-hidden shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35)]",
                padding,
                textColor,
                isHeld && "scale-[1.03] shadow-lg ring-2 ring-white/80 z-30",
                popOut && "z-20 shadow-lg",
                keyboardFocused &&
                  "group-data-keyboard-mode/grid:outline-2 group-data-keyboard-mode/grid:-outline-offset-2 group-data-keyboard-mode/grid:outline-foreground",
                event.isTask && event.completed && "opacity-50",
              )}
              role={event.isTask ? "group" : "button"}
              aria-label={describeEvent(event, selected)}
              aria-keyshortcuts={event.isTask ? "M Control+Enter" : "M"}
              id={eventDomId(event, day)}
              data-event-key={eventKey(event)}
              style={blockStyle}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onPointerDown={useCallback(
                (e: React.PointerEvent) => {
                  if ((e.target as HTMLElement).closest(".resize-handle")) {
                    collapsePopOut();
                    setViewingEvent(null);
                    return;
                  }
                  if (e.pointerType === "touch") {
                    handleTouchPointerDown(e);
                  } else {
                    dragStartRef.current = { x: e.clientX, y: e.clientY };
                    mouseDownRef.current = true;
                    onPointerDown(e, "move", event, day);
                  }
                },
                [
                  collapsePopOut,
                  setViewingEvent,
                  handleTouchPointerDown,
                  day,
                  event,
                  onPointerDown,
                ],
              )}
              onPointerMove={handleTouchPointerMove}
              onPointerUp={handleTouchPointerUp}
              onPointerCancel={handleTouchPointerCancel}
              onContextMenu={(e) => {
                if (isMobile) e.preventDefault();
              }}
              onClick={handleClick}
              onDoubleClick={() => {
                window.clearTimeout(clickTimerRef.current);
                runAction(settings.doubleClick);
              }}
              ref={blockRef}
            >
              {!event._continued || titleSpan ? (
                <>
                  <div
                    dir={i18n.dir()}
                    className={cn(
                      "flex items-start gap-1",
                      spanning ? "pointer-events-none" : "justify-between",
                    )}
                    style={titleStyle}
                  >
                    <div
                      dir="auto"
                      className={cn(
                        "font-semibold",
                        event.allDay && "min-w-0 truncate",
                        event.isTask && event.completed && "line-through",
                      )}
                      style={
                        event.allDay
                          ? undefined
                          : {
                              display: "-webkit-box",
                              WebkitBoxOrient: "vertical",
                              WebkitLineClamp: lineClamp,
                              overflow: "hidden",
                            }
                      }
                    >
                      {event.title}
                    </div>
                    {event.isTask && (
                      <Checkbox
                        className="pointer-events-auto mt-0.5 shrink-0 border-current/50"
                        aria-label={t("block.completed", {
                          title: event.title,
                        })}
                        tabIndex={-1}
                        checked={event.completed ?? false}
                        onPointerDown={stopPropagation}
                        onCheckedChange={(c) => toggleCompleted(!!c)}
                      />
                    )}
                  </div>
                  {!event.allDay && (
                    <span
                      dir={i18n.dir()}
                      className={cn(
                        "text-xs block",
                        event.isTask && event.completed && "line-through",
                      )}
                    >
                      {timeLabel}
                    </span>
                  )}
                </>
              ) : (
                !event.allDay && (
                  <div className="flex justify-end">
                    <RedoDot size={16} />
                  </div>
                )
              )}

              {/* handles for resizing */}
              {startsToday && (
                <div
                  className={cn(
                    "hidden md:block absolute resize-handle hover:bg-background/20",
                    event.allDay
                      ? cn(
                          "inset-y-0 w-2 cursor-ew-resize",
                          rtl ? "right-0" : "left-0",
                        )
                      : "top-0 left-0 right-0 h-2 cursor-ns-resize",
                  )}
                  onPointerDown={(e) =>
                    onPointerDown(e, "resize_start", event, day)
                  }
                />
              )}
              {endsToday && (
                <div
                  className={cn(
                    "hidden md:block absolute resize-handle hover:bg-background/20",
                    event.allDay
                      ? cn(
                          "inset-y-0 w-2 cursor-ew-resize",
                          rtl ? "left-0" : "right-0",
                        )
                      : "bottom-0 left-0 right-0 h-2 cursor-ns-resize",
                  )}
                  onPointerDown={(e) =>
                    onPointerDown(e, "resize_end", event, day)
                  }
                />
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent
            onPointerDown={stopPropagation}
            onCloseAutoFocus={(e) => {
              if (editing) e.preventDefault();
            }}
          >
            <EventMenuItems
              event={event}
              onEdit={() => setEditingEvent(event, day)}
              onMove={onEventMove}
              onDelete={onEventDelete}
              onDuplicate={onDuplicate}
              onDetach={onDetach}
              onReset={onReset}
            />
          </ContextMenuContent>
        </ContextMenu>

        {viewing && !editing ? (
          <EventDetails
            event={event}
            blockRef={blockRef}
            timeLabel={timeLabel}
            onToggleCompleted={toggleCompleted}
            onEdit={() => {
              setViewingEvent(null);
              setEditingEvent(event, day);
            }}
            onCancel={() => setViewingEvent(null)}
          />
        ) : null}

        {editing ? (
          <EventEditor
            event={event}
            day={day}
            blockRef={blockRef}
            restoreFocus={restoreFocus}
            onSave={(originalEvent, newEvent) => {
              onEventEdit(originalEvent, newEvent);
              setEditingEvent(null);
            }}
            onMove={(originalEvent, newEvent) => {
              onEventMove(originalEvent, newEvent);
              setEditingEvent(null);
            }}
            onDelete={handleDelete}
            onDuplicate={duplicate}
            onDetach={detach}
            onReset={reset}
            onCancel={() => setEditingEvent(null)}
          />
        ) : null}
      </>
    );
  },
  (prev, next) => {
    return (
      prev.event === next.event &&
      prev.day === next.day &&
      prev.titleSpan === next.titleSpan &&
      prev.editing === next.editing &&
      prev.viewing === next.viewing &&
      prev.selection === next.selection &&
      prev.restoreFocus === next.restoreFocus &&
      prev.onPointerDown === next.onPointerDown &&
      prev.onEventEdit === next.onEventEdit &&
      prev.onEventMove === next.onEventMove &&
      prev.onEventDelete === next.onEventDelete &&
      prev.onDuplicate === next.onDuplicate &&
      prev.onDetach === next.onDetach &&
      prev.onReset === next.onReset &&
      prev.setEditingEvent === next.setEditingEvent &&
      prev.setViewingEvent === next.setViewingEvent &&
      shallowEqual(prev.style, next.style)
    );
  },
);
