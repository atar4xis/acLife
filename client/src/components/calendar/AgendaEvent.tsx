import { useCalendarActions } from "@/context/CalendarContext";
import { cn } from "@/lib/utils";
import { EVENT_COLOR_FALLBACK } from "@/context/CalendarSettingsContext";
import type { CalendarEvent } from "@/types/calendar/Event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSidebar } from "../ui/sidebar";
import { Checkbox } from "../ui/checkbox";
import { timeFormat } from "@/lib/calendar/date";
import { useTranslation } from "react-i18next";

type AgendaEventProps = {
  event: CalendarEvent;
};
export default function AgendaEvent({ event }: AgendaEventProps) {
  const { t } = useTranslation();
  const { setEditingEvent, setCurrentDate, onEventEdit } = useCalendarActions();
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
    if (event.start.toMillis() < now) return t("agenda.inProgress");
    if (event.start.toMillis() - now > 86_400_000) return ""; // 24 hours

    const diff = event.start
      .diffNow()
      .shiftTo("days", "hours", "minutes", "seconds");

    const unit =
      diff.days >= 1
        ? "days"
        : diff.hours >= 1
          ? "hours"
          : diff.minutes >= 1
            ? "minutes"
            : "seconds";

    return t("agenda.startsIn", {
      duration: diff.shiftTo(unit).mapUnits(Math.ceil).toHuman(),
    });
  }, [event.start, now, t]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const toggleCompleted = useCallback(
    (checked: boolean) => {
      onEventEdit(event, { ...event, completed: checked });
    },
    [event, onEventEdit],
  );

  if (event.end.toMillis() <= now) return;

  return (
    <div
      className={cn(
        "relative w-full py-1 px-2 flex justify-between items-center text-foreground hover:bg-secondary hover:cursor-pointer",
        event.isTask && event.completed && "opacity-50",
      )}
    >
      <div className="font-semibold flex items-center">
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
            className="relative z-10 me-2 shrink-0"
            checked={event.completed ?? false}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(c) => toggleCompleted(!!c)}
          />
        )}
        <button
          type="button"
          className="flex cursor-pointer flex-col text-start after:absolute after:inset-0"
          onClick={() => {
            setCurrentDate(event.start.startOf("day"));
            setEditingEvent(event);
            setOpenMobile(false); // close sidebar
          }}
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
        <div className="text-xs font-normal truncate text-foreground/50">
          {event.start.toFormat(startTimeFormat) +
            " - " +
            event.end.toFormat(endTimeFormat)}
        </div>
      )}
    </div>
  );
}
