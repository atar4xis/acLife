import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { useEffect } from "react";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ user: { type: "offline" }, logout: vi.fn() }),
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ get: () => true, set: vi.fn() }),
}));

import AppSidebar from "../../src/components/Sidebar.tsx";
import { SidebarProvider } from "../../src/components/ui/sidebar.tsx";
import {
  CalendarProvider,
  useCalendarActions,
  useCurrentDate,
} from "../../src/context/CalendarContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import { applyLanguage } from "../../src/i18n";
import { seedSettings } from "../settingsStorage.ts";

function CurrentDate() {
  return (
    <span data-testid="current">{useCurrentDate().toISODate()}</span>
  );
}

function Seed({ events }: { events: CalendarEvent[] }) {
  const { dispatch } = useCalendarActions();

  useEffect(() => {
    events.forEach((event) => dispatch({ type: "add", event }));
    // eslint-disable-next-line
  }, []);

  return null;
}

// the tests run in UTC, so these instants fall on a different date there than in the default zone
const renderSidebar = (
  zone: string,
  now: string,
  events: CalendarEvent[] = [],
) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  seedSettings({ timezones: [zone], defaultTimezone: zone });

  return render(
    <SettingsStoreProvider>
      <CalendarProvider>
        <SidebarProvider>
          <Seed events={events} />
          <AppSidebar onOpenSettings={vi.fn()} />
          <CurrentDate />
        </SidebarProvider>
      </CalendarProvider>
    </SettingsStoreProvider>,
  );
};

const dayOf = (container: HTMLElement, attribute: string) =>
  container.querySelector(`[${attribute}="true"]`)?.textContent?.trim();

afterEach(() => {
  vi.useRealTimers();
  applyLanguage("en");
});

describe("sidebar calendar", () => {
  it.each([
    // ahead of UTC: still the 17th there, already the 18th in Auckland
    ["Pacific/Auckland", "2026-03-17T20:00:00Z", "2026-03-18", "18"],
    // behind UTC: already the 18th there, still the 17th in Los Angeles
    ["America/Los_Angeles", "2026-03-18T03:00:00Z", "2026-03-17", "17"],
  ])(
    "highlights today and selects the current day in the %s time zone",
    (zone, now, isoDate, day) => {
      const { container, getByTestId } = renderSidebar(zone, now);

      expect(getByTestId("current")).toHaveTextContent(isoDate);
      expect(dayOf(container, "data-today")).toBe(day);
      expect(dayOf(container, "data-selected")).toBe(day);
    },
  );

  it.each([
    ["Pacific/Auckland", "2026-03-17T20:00:00Z"],
    ["America/Los_Angeles", "2026-03-18T03:00:00Z"],
  ])("sets the day you click in the %s time zone", async (zone, now) => {
    const user = userEvent.setup();
    const { container, getByTestId, getByRole } = renderSidebar(zone, now);

    await user.click(getByRole("button", { name: /March 20th/ }));

    expect(getByTestId("current")).toHaveTextContent("2026-03-20");
    expect(dayOf(container, "data-selected")).toBe("20");
  });

  it("keeps the day buttons mounted when the date changes", async () => {
    const user = userEvent.setup();
    const { getByRole } = renderSidebar("UTC", "2026-03-18T10:00:00Z");
    const other = getByRole("button", { name: /March 25th/ });

    await user.click(getByRole("button", { name: /March 20th/ }));

    expect(other.isConnected).toBe(true);
  });
});

describe("mini calendar settings", () => {
  const ZONE = "UTC";
  const NOW = "2026-03-18T10:00:00Z";
  const at = (
    day: number,
    hour: number,
    id: string,
    extra: Partial<CalendarEvent> = {},
  ): CalendarEvent => ({
    id,
    title: id,
    start: DateTime.fromObject(
      { year: 2026, month: 3, day, hour },
      { zone: ZONE },
    ),
    end: DateTime.fromObject(
      { year: 2026, month: 3, day, hour: hour + 1 },
      { zone: ZONE },
    ),
    timestamp: 0,
    ...extra,
  });

  const render_ = (settings: object, events: CalendarEvent[] = []) => {
    seedSettings({ timezones: [ZONE], defaultTimezone: ZONE, ...settings });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    return render(
      <SettingsStoreProvider>
        <CalendarProvider>
          <SidebarProvider>
            <Seed events={events} />
            <AppSidebar onOpenSettings={vi.fn()} />
          </SidebarProvider>
        </CalendarProvider>
      </SettingsStoreProvider>,
    );
  };

  it("hides the calendar when disabled", () => {
    const { container } = render_({ miniCalendarEnabled: false });

    expect(container.querySelector("[data-slot='calendar']")).toBeNull();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("shows the calendar by default", () => {
    render_({});

    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("shows week numbers only when enabled", () => {
    const { unmount } = render_({});
    expect(screen.queryAllByRole("rowheader")).toHaveLength(0);
    unmount();

    render_({ miniCalendarWeekNumbers: true });
    expect(screen.getAllByRole("rowheader").length).toBeGreaterThan(0);
  });

  it("shows month and year dropdowns only when enabled", () => {
    const { unmount } = render_({});
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    unmount();

    render_({ miniCalendarDropdowns: true });
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
  });

  it("renders no event bars unless enabled", () => {
    const { unmount } = render_({}, [at(18, 9, "a")]);
    expect(screen.queryAllByTestId("event-bar")).toHaveLength(0);
    unmount();

    render_({ miniCalendarEventBars: true }, [at(18, 9, "a")]);
    expect(screen.getAllByTestId("event-bar")).toHaveLength(1);
  });

  it("keeps the day buttons and bars when picking a day in the viewed month", async () => {
    const user = userEvent.setup();
    render_({ miniCalendarEventBars: true }, [at(18, 9, "a")]);
    const other = screen.getByRole("button", { name: /March 25th/ });

    await user.click(screen.getByRole("button", { name: /March 20th/ }));

    expect(other.isConnected).toBe(true);
    expect(screen.getAllByTestId("event-bar")).toHaveLength(1);
  });

  it("colors each bar after its event", () => {
    render_({ miniCalendarEventBars: true }, [
      at(18, 9, "a", { color: "rgb(255, 0, 0)" }),
      at(18, 11, "b", { color: "rgb(0, 0, 255)" }),
    ]);

    const colors = screen
      .getAllByTestId("event-bar")
      .map((bar) => (bar as HTMLElement).style.backgroundColor);
    expect(colors).toEqual(["rgb(255, 0, 0)", "rgb(0, 0, 255)"]);
  });

  it("caps the bars at 3 and shows how many events are hidden", () => {
    render_(
      { miniCalendarEventBars: true },
      [8, 9, 10, 11, 12].map((h) => at(18, h, `e${h}`)),
    );

    expect(screen.getAllByTestId("event-bar")).toHaveLength(3);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("shows no overflow label at exactly 3 events", () => {
    render_(
      { miniCalendarEventBars: true },
      [8, 9, 10].map((h) => at(18, h, `e${h}`)),
    );

    expect(screen.getAllByTestId("event-bar")).toHaveLength(3);
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it("draws a multi-day event on every day it covers", () => {
    render_({ miniCalendarEventBars: true }, [
      at(18, 9, "long", {
        end: DateTime.fromISO("2026-03-20T10:00", { zone: ZONE }),
      }),
    ]);

    expect(screen.getAllByTestId("event-bar")).toHaveLength(3);
  });

  it.each(["en", "ar"])(
    "caps only the ends of a multi-day bar with logical classes in %s",
    (language) => {
      applyLanguage(language);
      render_({ miniCalendarEventBars: true }, [
        at(18, 9, "long", {
          end: DateTime.fromISO("2026-03-20T10:00", { zone: ZONE }),
        }),
      ]);

      const [first, middle, last] = screen
        .getAllByTestId("event-bar")
        .map((bar) => bar.className);
      expect(first).toContain("ms-[12%] rounded-s-full");
      expect(first).not.toContain("me-[12%]");
      expect(middle).not.toMatch(/ms-|me-|rounded-/);
      expect(last).toContain("me-[12%] rounded-e-full");
      expect(last).not.toContain("ms-[12%]");
    },
  );
});
