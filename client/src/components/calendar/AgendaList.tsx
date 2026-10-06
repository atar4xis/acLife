import { memo, useEffect, useMemo, useState } from "react";
import { SidebarGroup, SidebarGroupLabel } from "../ui/sidebar";
import { useEventList } from "@/context/CalendarContext";
import { getRelativeDays } from "@/lib/calendar/date";
import { DateTime } from "luxon";
import { eventKey, getEventMap } from "@/lib/calendar/event";
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
    showOverdueTasks: s.showOverdueTasks,
    overdueDays: s.overdueDays,
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

    const firstDate = visibleDays[0]?.date.toISODate();

    for (const [date, events] of eventMap) {
      const upcoming = events
        .filter(
          (e) =>
            e.end.toMillis() > now &&
            (!e._continued || date === firstDate) &&
            !(e.isTask && e.completed),
        )
        .toSorted((a, b) => a.start.toMillis() - b.start.toMillis());

      if (upcoming.length) {
        result.set(date, upcoming);
      }
    }

    return result;
  }, [eventMap, visibleDays]);

  const overdueTasks = useMemo(() => {
    if (!settings.showOverdueTasks) return EMPTY_ARRAY;
    const today = now.startOf("day");
    const days = Array.from({ length: settings.overdueDays + 1 }, (_, i) =>
      today.minus({ days: settings.overdueDays - i }),
    );
    const nowMillis = now.toMillis();
    const cutoff = now.minus({ days: settings.overdueDays }).toMillis();
    const tasks = new Map<string, CalendarEvent>();
    for (const events of getEventMap(
      calendarEvents,
      days,
      EMPTY_ARRAY,
      EMPTY_ARRAY,
    ).values()) {
      for (const e of events) {
        const end = e.end.toMillis();
        if (e.isTask && !e.completed && end <= nowMillis && end > cutoff) {
          tasks.set(eventKey(e), e);
        }
      }
    }
    return [...tasks.values()].toSorted(
      (a, b) => a.end.toMillis() - b.end.toMillis(),
    );
  }, [calendarEvents, now, settings.showOverdueTasks, settings.overdueDays]);

  useEffect(() => {
    setNow((prev) => prev.setZone(settings.defaultTimezone));
    const interval = setInterval(
      () => setNow(DateTime.now().setZone(settings.defaultTimezone)),
      60000,
    );
    return () => clearInterval(interval);
  }, [settings.defaultTimezone]);

  return (
    <>
      {overdueTasks.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel className="mb-1 bg-destructive/5 text-destructive">
            {t("agenda.overdue")} · {overdueTasks.length}
          </SidebarGroupLabel>
          {overdueTasks.map((event) => (
            <AgendaEvent key={eventKey(event)} event={event} overdue />
          ))}
        </SidebarGroup>
      )}
      {visibleDays.map((d) => {
        const key = d.date.toISODate()!;
        const events = sortedEventMap.get(key);

        if (!events) return null;

        return (
          <SidebarGroup key={key}>
            <SidebarGroupLabel>
              {d.label} · {events.length}
            </SidebarGroupLabel>
            {events.map((event) => (
              <AgendaEvent
                key={
                  (event._parent || event.id) + "_" + event.start.toISODate()
                }
                event={event}
              />
            ))}
          </SidebarGroup>
        );
      })}
    </>
  );
});
