import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  useCalendar,
} from "../../src/context/CalendarContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import { seedSettings } from "../settingsStorage.ts";

function CurrentDate() {
  return (
    <span data-testid="current">{useCalendar().currentDate.toISODate()}</span>
  );
}

// the tests run in UTC, so these instants fall on a different date there than in the default zone
const renderSidebar = (zone: string, now: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  seedSettings({ timezones: [zone], defaultTimezone: zone });

  return render(
    <SettingsStoreProvider>
      <CalendarProvider>
        <SidebarProvider>
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
});
