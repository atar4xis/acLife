import { memo, useEffect, useMemo, useState } from "react";
import { SidebarGroup, SidebarGroupLabel } from "../ui/sidebar";
import { useEventList } from "@/context/CalendarContext";
import { getRelativeDays } from "@/lib/calendar/date";
import { DateTime } from "luxon";
import { getEventMap } from "@/lib/calendar/event";
import { EMPTY_ARRAY } from "@/lib/constants";
import AgendaEvent from "./AgendaEvent";
import type { CalendarEvent } from "@/types/calendar/Event";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { useTranslation } from "react-i18next";

export default memo(function AgendaList() {
  const { t, i18n } = useTranslation();
  const calendarEvents = useEventList();
  const settings = useCalendarSettings((s) => ({
    agendaRangeDays: s.agendaRangeDays,
    defaultTimezone: s.defaultTimezone,
  }));
  const [now, setNow] = useState(() =>
    DateTime.now().setZone(settings.defaultTimezone),
  );
  const visibleDays = useMemo(
    () =>
      getRelativeDays(now.setLocale(i18n.language), settings.agendaRangeDays),
    // eslint-disable-next-line
    [now, settings.agendaRangeDays, t, i18n.language],
  );

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
        .filter(
          (e) =>
            e.end.toMillis() > now &&
            !e._continued &&
            !(e.isTask && e.completed),
        )
        .toSorted((a, b) => a.start.toMillis() - b.start.toMillis());

      if (upcoming.length) {
        result.set(date, upcoming);
      }
    }

    return result;
  }, [eventMap]);

  useEffect(() => {
    setNow((prev) => prev.setZone(settings.defaultTimezone));
    const interval = setInterval(
      () => setNow(DateTime.now().setZone(settings.defaultTimezone)),
      60000,
    );
    return () => clearInterval(interval);
  }, [settings.defaultTimezone]);

  return visibleDays.map((d) => {
    const key = d.date.toISODate()!;
    const events = sortedEventMap.get(key);

    if (!events) return null;

    return (
      <SidebarGroup key={key}>
        <SidebarGroupLabel>{d.label}</SidebarGroupLabel>
        {events.map((event) => (
          <AgendaEvent
            key={(event._parent || event.id) + "_" + event.start.toISODate()}
            event={event}
          />
        ))}
      </SidebarGroup>
    );
  });
});
