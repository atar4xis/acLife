import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTime, Settings } from "luxon";
import { useEffect } from "react";
import AgendaList from "../../src/components/calendar/AgendaList.tsx";
import AppCalendar from "../../src/components/calendar/Calendar.tsx";
import {
  CalendarProvider,
  useCalendarActions,
} from "../../src/context/CalendarContext.tsx";
import {
  SettingsStoreProvider,
  useSettingsStore,
} from "../../src/context/SettingsStoreContext.tsx";
import { SidebarProvider } from "../../src/components/ui/sidebar.tsx";
import { buildEvent } from "./helpers.tsx";
import type { SettingsStore } from "../../src/lib/settingsStore.ts";
import { seedSettings } from "../settingsStorage.ts";

const FIXED_NOW = DateTime.fromISO("2026-03-18T10:00:00");

function Seed({ events }: { events: ReturnType<typeof buildEvent>[] }) {
  const { dispatch } = useCalendarActions();

  useEffect(() => {
    events.forEach((event) => dispatch({ type: "add", event }));
    // eslint-disable-next-line
  }, []);

  return null;
}

const renderAgendaList = (events: ReturnType<typeof buildEvent>[]) =>
  render(
    <SettingsStoreProvider>
      <CalendarProvider>
        <SidebarProvider>
          <Seed events={events} />
          <AgendaList />
        </SidebarProvider>
      </CalendarProvider>
    </SettingsStoreProvider>,
  );

const renderAgendaAndCalendar = (events: ReturnType<typeof buildEvent>[]) => {
  const user = userEvent.setup();

  render(
    <SettingsStoreProvider>
      <CalendarProvider>
        <SidebarProvider>
          <AgendaList />
        </SidebarProvider>
        <AppCalendar
          events={events}
          mode="week"
          setMode={vi.fn()}
          saveEvents={vi.fn()}
          syncEvents={vi.fn()}
          syncBuckets={vi.fn()}
          saveDebounceMs={0}
        />
      </CalendarProvider>
    </SettingsStoreProvider>,
  );

  return { user };
};

function StoreProbe({ onStore }: { onStore: (s: SettingsStore) => void }) {
  onStore(useSettingsStore());
  return null;
}

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

  describe("overdue tasks", () => {
    const task = (id: string, hoursAgo: number, extra = {}) =>
      buildEvent({
        id,
        title: id,
        isTask: true,
        start: FIXED_NOW.minus({ hours: hoursAgo + 1 }),
        end: FIXED_NOW.minus({ hours: hoursAgo }),
        ...extra,
      });

    it("lists overdue tasks under Overdue with the time overdue", () => {
      renderAgendaList([
        task("two-hours", 2),
        task("two-days", 49),
        task("done", 3, { completed: true }),
        buildEvent({
          id: "plain",
          title: "plain",
          start: FIXED_NOW.minus({ hours: 3 }),
          end: FIXED_NOW.minus({ hours: 2 }),
        }),
      ]);

      expect(screen.getByText("Overdue · 2")).toBeInTheDocument();
      expect(screen.getByText("2 hours")).toBeInTheDocument();
      expect(screen.getByText("2 days")).toBeInTheDocument();
      expect(screen.queryByText("done")).not.toBeInTheDocument();
      expect(screen.queryByText("plain")).not.toBeInTheDocument();
      expect(screen.queryByText("in progress")).not.toBeInTheDocument();
    });

    it("shows exactly one unit in the largest whole unit", () => {
      renderAgendaList([task("one-hour", 1)]);

      expect(screen.getByText("1 hour")).toBeInTheDocument();
    });

    it("drops tasks overdue for longer than overdueDays", () => {
      renderAgendaList([task("old", 24 * 4)]);

      expect(screen.queryByText("old")).not.toBeInTheDocument();
    });

    it("keeps them longer when overdueDays is increased", () => {
      seedSettings({ overdueDays: 7 });
      renderAgendaList([task("old", 24 * 4)]);

      expect(screen.getByText("old")).toBeInTheDocument();
      expect(screen.getByText("4 days")).toBeInTheDocument();
    });

    it("includes tasks that end exactly now but not ones at the cutoff", () => {
      renderAgendaList([task("ends-now", 0), task("at-cutoff", 72)]);

      expect(screen.getByText("Overdue · 1")).toBeInTheDocument();
      expect(screen.getByText("ends-now")).toBeInTheDocument();
      expect(screen.queryByText("at-cutoff")).not.toBeInTheDocument();
    });

    it("ignores tasks that have not ended yet", () => {
      renderAgendaList([task("upcoming", -2)]);

      expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
      expect(screen.getByText("upcoming")).toBeInTheDocument();
    });

    it("sorts overdue tasks by end time, oldest first", () => {
      renderAgendaList([task("a", 5), task("b", 30), task("c", 2)]);

      const titles = screen.getAllByText(/^[abc]$/).map((e) => e.textContent);
      expect(titles).toEqual(["b", "a", "c"]);
    });

    it("lists a multi-day task once", () => {
      renderAgendaList([
        buildEvent({
          id: "long",
          title: "long",
          isTask: true,
          start: FIXED_NOW.minus({ days: 2 }),
          end: FIXED_NOW.minus({ hours: 2 }),
        }),
      ]);

      expect(screen.getByText("Overdue · 1")).toBeInTheDocument();
      expect(screen.getAllByText("long")).toHaveLength(1);
    });

    it("hides them when showOverdueTasks is off", () => {
      seedSettings({ showOverdueTasks: false });
      renderAgendaList([task("two-hours", 2)]);

      expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
      expect(screen.queryByText("two-hours")).not.toBeInTheDocument();
    });
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

  it("labels all day events instead of showing a time range", () => {
    renderAgendaList([
      buildEvent({
        id: "holiday",
        title: "Holiday",
        allDay: true,
        start: FIXED_NOW.startOf("day"),
        end: FIXED_NOW.endOf("day"),
      }),
    ]);

    expect(screen.getByText("All day")).toBeInTheDocument();
    expect(screen.queryByText(/12:00 AM/)).not.toBeInTheDocument();
  });

  it("includes events further out when agendaRangeDays is increased", () => {
    seedSettings({ agendaRangeDays: 7 });

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
    seedSettings({ agendaRangeDays: 1 });

    const event = buildEvent({
      id: "tomorrow",
      title: "Tomorrow event",
      start: FIXED_NOW.plus({ days: 1, hours: 1 }),
      end: FIXED_NOW.plus({ days: 1, hours: 2 }),
    });

    renderAgendaList([event]);

    expect(screen.queryByText("Tomorrow event")).not.toBeInTheDocument();
  });

  it("regroups days immediately when the default timezone changes", () => {
    let store!: SettingsStore;
    const event = buildEvent({
      id: "tz",
      title: "Tz event",
      start: FIXED_NOW.plus({ hours: 1 }),
      end: FIXED_NOW.plus({ hours: 2 }),
    });

    render(
      <SettingsStoreProvider>
        <CalendarProvider>
          <SidebarProvider>
            <StoreProbe onStore={(s) => (store = s)} />
            <Seed events={[event]} />
            <AgendaList />
          </SidebarProvider>
        </CalendarProvider>
      </SettingsStoreProvider>,
    );

    expect(screen.getByText("Today · 1")).toBeInTheDocument();

    act(() => {
      store.setSettings({
        defaultTimezone: "Pacific/Pago_Pago",
        timezones: ["Pacific/Pago_Pago"],
      });
    });

    expect(screen.getByText("Tomorrow · 1")).toBeInTheDocument();
    expect(screen.queryByText("Today · 1")).not.toBeInTheDocument();
  });

  it("shows only one editor when clicking a multi-day event from the agenda view", async () => {
    const multiDayEvent = buildEvent({
      id: "multi-day",
      title: "Party",
      description: undefined,
      start: FIXED_NOW.startOf("day").plus({ hours: 23 }),
      end: FIXED_NOW.startOf("day").plus({ days: 1, hours: 1 }),
    });

    const { user } = renderAgendaAndCalendar([multiDayEvent]);

    const agendaLabel = (await screen.findAllByText("Party"))[0];
    await user.click(agendaLabel);

    expect(
      await screen.findAllByRole("heading", { name: /edit event/i }),
    ).toHaveLength(1);
  });
});
