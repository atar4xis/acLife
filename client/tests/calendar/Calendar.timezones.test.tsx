import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import {
  getDeviceTimezone,
  getTimezoneHourLabel,
  getTimezoneShortLabel,
} from "../../src/lib/calendar/timezone.ts";
import { FIXED_NOW, renderCalendar, setupCalendarTests } from "./helpers";

setupCalendarTests();

const STORAGE_KEY = "acl-calendar-settings";
const DEVICE_TZ = getDeviceTimezone();

if (["Asia/Tokyo", "Australia/Sydney"].includes(DEVICE_TZ)) {
  throw new Error(
    "test fixture time zone collides with this machine's device time zone",
  );
}

const setCalendarSettings = (overrides: Record<string, unknown>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
};

const getHourCells = () =>
  Array.from(document.querySelectorAll(".z-5")) as HTMLElement[];

// the day/week HeaderCell also uses z-16, so filter to ones with an inline left offset
const getHeaderCells = () =>
  Array.from(document.querySelectorAll(".z-16[style]")) as HTMLElement[];

describe("Calendar with multiple time zones", () => {
  it("renders a single time zone column by default", () => {
    setCalendarSettings({ timezones: [DEVICE_TZ], defaultTimezone: DEVICE_TZ });
    renderCalendar({ mode: "day" });

    const grid = document.querySelector(".calendar-grid-scroll") as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("repeat(1, 3.5rem) 1fr");
    const headers = getHeaderCells();
    expect(headers).toHaveLength(1);
    expect(headers[0]).toHaveTextContent("");
  });

  it("adds one grid column and one header label per additional time zone", () => {
    setCalendarSettings({
      timezones: [DEVICE_TZ, "Asia/Tokyo"],
      defaultTimezone: DEVICE_TZ,
    });
    renderCalendar({ mode: "day" });

    const headers = getHeaderCells();
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveTextContent(getTimezoneShortLabel(DEVICE_TZ));
    expect(headers[1]).toHaveTextContent("Tokyo");
  });

  it("shows each additional time zone's own local hour next to the default's", () => {
    setCalendarSettings({
      timezones: [DEVICE_TZ, "Asia/Tokyo"],
      defaultTimezone: DEVICE_TZ,
    });
    renderCalendar({ mode: "day" });

    const reference = FIXED_NOW.startOf("day");
    const hourCells = getHourCells();

    expect(hourCells).toHaveLength(48);

    for (let hour = 0; hour < 24; hour++) {
      const defaultLabel = getTimezoneHourLabel(reference, hour, DEVICE_TZ);
      const tokyoLabel = getTimezoneHourLabel(reference, hour, "Asia/Tokyo");

      expect(hourCells[hour * 2]).toHaveTextContent(defaultLabel);
      expect(hourCells[hour * 2 + 1]).toHaveTextContent(tokyoLabel);
    }
  });

  it("only highlights the default time zone's current-hour cell, not other time zones'", () => {
    setCalendarSettings({
      timezones: [DEVICE_TZ, "Asia/Tokyo"],
      defaultTimezone: DEVICE_TZ,
    });
    renderCalendar({ mode: "day" });

    const currentHour = FIXED_NOW.setZone(DEVICE_TZ).hour;
    const hourCells = getHourCells();
    const defaultCell = hourCells[currentHour * 2];
    const tokyoCell = hourCells[currentHour * 2 + 1];

    expect(defaultCell.className).toContain("bg-card");
    expect(defaultCell.className).toContain("font-bold");
    expect(tokyoCell.className).not.toContain("bg-card");
    expect(tokyoCell.className).toContain("bg-background");
  });

  it("does not highlight any cell at an hour other than the current one", () => {
    setCalendarSettings({
      timezones: [DEVICE_TZ, "Asia/Tokyo"],
      defaultTimezone: DEVICE_TZ,
    });
    renderCalendar({ mode: "day" });

    const currentHour = FIXED_NOW.setZone(DEVICE_TZ).hour;
    const otherHour = (currentHour + 5) % 24;
    const hourCells = getHourCells();

    expect(hourCells[otherHour * 2].className).not.toContain("bg-card");
    expect(hourCells[otherHour * 2 + 1].className).not.toContain("bg-card");
  });

  it("renders a header and hour label for a third time zone when added", async () => {
    setCalendarSettings({
      timezones: [DEVICE_TZ, "Asia/Tokyo", "Australia/Sydney"],
      defaultTimezone: DEVICE_TZ,
    });
    renderCalendar({ mode: "day" });

    expect(getHourCells()).toHaveLength(24 * 3);
    expect(await screen.findByText("Sydney")).toBeInTheDocument();
  });
});
