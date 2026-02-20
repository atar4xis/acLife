import { memo, useEffect, useMemo, useState } from "react";
import { SidebarGroup, SidebarGroupLabel } from "../ui/sidebar";
import { useCalendar } from "@/context/CalendarContext";
import { getRelativeDays } from "@/lib/calendar/date";
import { DateTime } from "luxon";
import { getEventMap } from "@/lib/calendar/event";
import { EMPTY_ARRAY } from "@/lib/constants";
import AgendaEvent from "./AgendaEvent";
import type { CalendarEvent } from "@/types/calendar/Event";

// TODO: make this configurable
const DAYS_AHEAD = 3;

export default memo(function AgendaList() {
  const { calendarEvents } = useCalendar();
  const [now, setNow] = useState(DateTime.now());
  const visibleDays = useMemo(() => getRelativeDays(now, DAYS_AHEAD), [now]);

  const eventMap = useMemo(
    () =>
      getEventMap(
        calendarEvents,
        visibleDays.map((d) => d.date),
        EMPTY_ARRAY,
        EMPTY_ARRAY,
      ),
    [calendarEvents, visibleDays],
  );

  const sortedEventMap = useMemo(() => {
    const now = Date.now();
    const result = new Map<string, CalendarEvent[]>();

    for (const [date, events] of eventMap) {
      const upcoming = events
        .filter((e) => e.end.toMillis() > now)
        .sort((a, b) => a.start.toMillis() - b.start.toMillis());

      if (upcoming.length) {
        result.set(date, upcoming);
      }
    }

    return result;
  }, [eventMap]);

  useEffect(() => {
    const interval = setInterval(() => setNow(DateTime.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  return visibleDays.map((d) => {
    const key = d.date.toISODate()!;
    const events = sortedEventMap.get(key);

    if (!events) return null;

    return (
      <SidebarGroup key={key}>
        <SidebarGroupLabel>{d.label}</SidebarGroupLabel>
        {events.map((event) => (
          <AgendaEvent key={event._parent || event.id} event={event} />
        ))}
      </SidebarGroup>
    );
  });
});
