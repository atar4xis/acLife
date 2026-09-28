import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DateTime, Settings } from "luxon";
import { useEffect } from "react";
import AgendaList from "../../src/components/calendar/AgendaList.tsx";
import { CalendarProvider, useCalendar } from "../../src/context/CalendarContext.tsx";
import { CalendarSettingsProvider } from "../../src/context/CalendarSettingsContext.tsx";
import { SidebarProvider } from "../../src/components/ui/sidebar.tsx";
import { buildEvent } from "./helpers.tsx";

const STORAGE_KEY = "acl-calendar-settings";
const FIXED_NOW = DateTime.fromISO("2026-03-18T10:00:00");

function Seed({ events }: { events: ReturnType<typeof buildEvent>[] }) {
  const { dispatch } = useCalendar();

  useEffect(() => {
    events.forEach((event) => dispatch({ type: "add", event }));
    // eslint-disable-next-line
  }, []);

  return null;
}

const renderAgendaList = (events: ReturnType<typeof buildEvent>[]) =>
  render(
    <CalendarSettingsProvider>
      <CalendarProvider>
        <SidebarProvider>
          <Seed events={events} />
          <AgendaList />
        </SidebarProvider>
      </CalendarProvider>
    </CalendarSettingsProvider>,
  );

describe("AgendaList", () => {
  beforeEach(() => {
    Settings.now = () => FIXED_NOW.toMillis();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW.toJSDate());
  });

  afterEach(() => {
    vi.useRealTimers();
    Settings.now = () => Date.now();
    localStorage.clear();
  });

  it("only shows events within the default 3 day range", () => {
    const withinRange = buildEvent({
      id: "within",
      title: "Within range",
      start: FIXED_NOW.plus({ days: 2, hours: 1 }),
      end: FIXED_NOW.plus({ days: 2, hours: 2 }),
    });
    const outsideRange = buildEvent({
      id: "outside",
      title: "Outside range",
      start: FIXED_NOW.plus({ days: 5, hours: 1 }),
      end: FIXED_NOW.plus({ days: 5, hours: 2 }),
    });

    renderAgendaList([withinRange, outsideRange]);

    expect(screen.getByText("Within range")).toBeInTheDocument();
    expect(screen.queryByText("Outside range")).not.toBeInTheDocument();
  });

  it("includes events further out when agendaRangeDays is increased", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ agendaRangeDays: 7 }),
    );

    const event = buildEvent({
      id: "far",
      title: "Far event",
      start: FIXED_NOW.plus({ days: 5, hours: 1 }),
      end: FIXED_NOW.plus({ days: 5, hours: 2 }),
    });

    renderAgendaList([event]);

    expect(screen.getByText("Far event")).toBeInTheDocument();
  });

  it("excludes an event that falls outside a narrowed agendaRangeDays", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ agendaRangeDays: 1 }));

    const event = buildEvent({
      id: "tomorrow",
      title: "Tomorrow event",
      start: FIXED_NOW.plus({ days: 1, hours: 1 }),
      end: FIXED_NOW.plus({ days: 1, hours: 2 }),
    });

    renderAgendaList([event]);

    expect(screen.queryByText("Tomorrow event")).not.toBeInTheDocument();
  });
});
