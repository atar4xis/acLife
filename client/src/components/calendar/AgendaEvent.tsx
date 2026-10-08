import { useCalendarActions } from "@/context/CalendarContext";
import { cn } from "@/lib/utils";
import { EVENT_COLOR_FALLBACK } from "@/context/CalendarSettingsContext";
import type { CalendarEvent } from "@/types/calendar/Event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSidebar } from "../ui/sidebar";
import { Checkbox } from "../ui/checkbox";
import {
  DURATION_UNITS,
  humanizeDuration,
  timeFormat,
} from "@/lib/calendar/date";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { EventMenuItems } from "./EventMenuItems";

type AgendaEventProps = {
  event: CalendarEvent;
  overdue?: boolean;
};
export default function AgendaEvent({ event, overdue }: AgendaEventProps) {
  const { t } = useTranslation();
  const { setEditingEvent, setCurrentDate, eventHandlers } =
    useCalendarActions();
  const { setOpenMobile } = useSidebar();
  const [now, setNow] = useState(Date.now());
  const { eventColor, startTimeFormat, endTimeFormat } = useMemo(() => {
    const color = event.color ?? EVENT_COLOR_FALLBACK;
    const sameMeridiem = event.start.toFormat("a") === event.end.toFormat("a");
    return {
      eventColor: color,
      startTimeFormat: timeFormat(event.start, !sameMeridiem),
      endTimeFormat: timeFormat(event.end),
    };
    // eslint-disable-next-line
  }, [event.start, event.end, event.color, t]);

  const startsInText = useMemo(() => {
    if (overdue) return "";
    if (event.start.toMillis() < now) return t("agenda.inProgress");
    if (event.start.toMillis() - now > 86_400_000) return ""; // 24 hours

    const diff = event.start.diffNow(DURATION_UNITS);

    return t("agenda.startsIn", {
      duration: humanizeDuration(diff, Math.ceil),
    });
  }, [overdue, event.start, now, t]);

  const timeText = useMemo(() => {
    if (overdue) {
      const diff = DateTime.fromMillis(now).diff(event.end, DURATION_UNITS);
      return humanizeDuration(diff, Math.floor);
    }
    if (event.allDay) return t("editor.allDay");
    return (
      event.start.toFormat(startTimeFormat) +
      " - " +
      event.end.toFormat(endTimeFormat)
    );
  }, [overdue, now, event, startTimeFormat, endTimeFormat, t]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const toggleCompleted = useCallback(
    (checked: boolean) => {
      eventHandlers.edit(event, { ...event, completed: checked });
    },
    [event, eventHandlers],
  );

  const openEditor = () => {
    setCurrentDate(event.start.startOf("day"));
    setEditingEvent(event);
    setOpenMobile(false); // close sidebar
  };

  if (!overdue && event.end.toMillis() <= now) return;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "relative w-full py-1 px-2 flex justify-between items-start text-foreground hover:bg-secondary hover:cursor-pointer",
            event.isTask && event.completed && "opacity-50",
          )}
        >
          <div className="font-semibold flex items-center min-w-0">
            <div
              className="me-2 self-stretch"
              style={{
                backgroundColor: eventColor,
              }}
            >
              &nbsp;
            </div>
            {event.isTask && event.start.toMillis() - now <= 86_400_000 && (
              <Checkbox
                className="relative z-10 me-2 mt-0.5 shrink-0 self-start"
                checked={event.completed ?? false}
                onClick={(e) => e.stopPropagation()}
                onCheckedChange={(c) => toggleCompleted(!!c)}
              />
            )}
            <button
              type="button"
              className="flex min-w-0 cursor-pointer flex-col text-start wrap-anywhere after:absolute after:inset-0"
              onClick={openEditor}
            >
              <span
                className={cn(
                  "text-sm",
                  event.isTask && event.completed && "line-through",
                )}
              >
                {event.title}
              </span>
              <span className="text-xs font-normal">{startsInText}</span>
            </button>
          </div>
          {!event._continued && (
            <div
              className={cn(
                "ms-2 mt-0.5 shrink-0 text-xs font-normal truncate",
                overdue ? "text-destructive/50" : "text-foreground/50",
              )}
            >
              {timeText}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <EventMenuItems
          event={event}
          onEdit={openEditor}
          onMove={eventHandlers.move}
          onDelete={eventHandlers.remove}
          onDuplicate={eventHandlers.duplicate}
          onDetach={eventHandlers.detach}
          onReset={eventHandlers.reset}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
