import { useCalendar } from "@/context/CalendarContext";
import type { CalendarEvent } from "@/types/calendar/Event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSidebar } from "../ui/sidebar";
import { Checkbox } from "../ui/checkbox";

type AgendaEventProps = {
  event: CalendarEvent;
};
export default function AgendaEvent({ event }: AgendaEventProps) {
  const { setEditingEvent, setCurrentDate, onEventEdit } = useCalendar();
  const { setOpenMobile } = useSidebar();
  const [now, setNow] = useState(Date.now());
  const { eventColor, startTimeFormat, endTimeFormat } = useMemo(() => {
    const color = event.color ?? "#2563eb";
    const sameMeridiem = event.start.toFormat("a") === event.end.toFormat("a");
    return {
      eventColor: color,
      startTimeFormat:
        (event.start.minute === 0 ? "h" : "h:mm") + (!sameMeridiem ? " a" : ""),
      endTimeFormat: event.end.minute === 0 ? "h a" : "h:mm a",
    };
  }, [event.start, event.end, event.color]);

  const startsInText = useMemo(() => {
    if (event.start.toMillis() < now) return "in progress";
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

    return `in ${diff.shiftTo(unit).mapUnits(Math.ceil).toHuman()}`;
  }, [event.start, now]);

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
      className={`w-full py-1 px-2 flex justify-between items-center text-foreground hover:bg-secondary hover:cursor-pointer ${event.isTask && event.completed ? "opacity-50" : ""}`}
      onClick={() => {
        setCurrentDate(event.start.startOf("day"));
        setEditingEvent(event);
        setOpenMobile(false); // close sidebar
      }}
    >
      <div className="font-semibold flex items-center">
        <div
          className="mr-2 self-stretch"
          style={{
            backgroundColor: eventColor,
          }}
        >
          &nbsp;
        </div>
        {event.isTask && event.start.toMillis() - now <= 86_400_000 && (
          <Checkbox
            className="mr-2 shrink-0"
            checked={event.completed ?? false}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(c) => toggleCompleted(!!c)}
          />
        )}
        <div className="flex flex-col">
          <span
            className={`text-sm ${event.isTask && event.completed ? "line-through" : ""}`}
          >
            {event.title}
          </span>
          <span className="text-xs font-normal">{startsInText}</span>
        </div>
      </div>
      {!event._continued && (
        <div className="text-xs font-normal truncate text-foreground/50">
          {event.start.toFormat(startTimeFormat) +
            "-" +
            event.end.toFormat(endTimeFormat)}
        </div>
      )}
    </div>
  );
}
