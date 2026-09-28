import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import TimezoneChangeDialog from "../../src/components/calendar/TimezoneChangeDialog.tsx";
import { CalendarSettingsProvider } from "../../src/context/CalendarSettingsContext.tsx";

const STORAGE_KEY = "acl-calendar-settings";

vi.mock("@/lib/calendar/timezone", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/calendar/timezone")>();
  return {
    ...actual,
    getDeviceTimezone: vi.fn(actual.getDeviceTimezone),
  };
});

import { getDeviceTimezone } from "@/lib/calendar/timezone";

const mockDetectedTimezone = (tz: string) => {
  vi.mocked(getDeviceTimezone).mockReturnValue(tz);
};

const seedSettings = (overrides: Record<string, unknown>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
};

const renderDialog = () =>
  render(
    <CalendarSettingsProvider>
      <TimezoneChangeDialog />
    </CalendarSettingsProvider>,
  );

describe("TimezoneChangeDialog", () => {
  it("stays closed when the device time zone matches the last seen one", () => {
    seedSettings({
      timezones: ["America/Chicago"],
      defaultTimezone: "America/Chicago",
      lastSeenDeviceTimezone: "America/Chicago",
    });
    mockDetectedTimezone("America/Chicago");

    renderDialog();

    expect(
      screen.queryByText("Device time zone changed"),
    ).not.toBeInTheDocument();
  });

  it("opens when the device time zone differs from the last seen one", () => {
    seedSettings({
      timezones: ["America/Chicago"],
      defaultTimezone: "America/Chicago",
      lastSeenDeviceTimezone: "America/Chicago",
    });
    mockDetectedTimezone("Asia/Tokyo");

    renderDialog();

    expect(screen.getByText("Device time zone changed")).toBeInTheDocument();
    expect(screen.getByText(/Asia\/Tokyo/)).toBeInTheDocument();
  });

  it("keeping the current time zone dismisses without changing the default", async () => {
    const user = userEvent.setup();
    seedSettings({
      timezones: ["America/Chicago"],
      defaultTimezone: "America/Chicago",
      lastSeenDeviceTimezone: "America/Chicago",
    });
    mockDetectedTimezone("Asia/Tokyo");

    renderDialog();
    await user.click(screen.getByText("Keep current"));

    expect(
      screen.queryByText("Device time zone changed"),
    ).not.toBeInTheDocument();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.defaultTimezone).toBe("America/Chicago");
    // remembers the new device zone so it doesn't ask again for it
    expect(stored.lastSeenDeviceTimezone).toBe("Asia/Tokyo");
  });

  it("does not re-prompt after the device time zone was already dismissed once", () => {
    seedSettings({
      timezones: ["America/Chicago"],
      defaultTimezone: "America/Chicago",
      lastSeenDeviceTimezone: "Asia/Tokyo",
    });
    mockDetectedTimezone("Asia/Tokyo");

    renderDialog();

    expect(
      screen.queryByText("Device time zone changed"),
    ).not.toBeInTheDocument();
  });

  it("setting as default applies the detected time zone, adds it to the list, and toasts", async () => {
    const user = userEvent.setup();
    seedSettings({
      timezones: ["America/Chicago"],
      defaultTimezone: "America/Chicago",
      lastSeenDeviceTimezone: "America/Chicago",
    });
    mockDetectedTimezone("Asia/Tokyo");

    renderDialog();
    await user.click(screen.getByText("Set as default"));

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.defaultTimezone).toBe("Asia/Tokyo");
    expect(stored.timezones).toEqual(["Asia/Tokyo", "America/Chicago"]);
    expect(stored.lastSeenDeviceTimezone).toBe("Asia/Tokyo");
    expect(toast.success).toHaveBeenCalledWith("Time zone set to Tokyo, Japan (also Australia)");
    expect(
      screen.queryByText("Device time zone changed"),
    ).not.toBeInTheDocument();
  });

  it("does not duplicate the detected time zone if it's already in the list", async () => {
    const user = userEvent.setup();
    seedSettings({
      timezones: ["America/Chicago", "Asia/Tokyo"],
      defaultTimezone: "America/Chicago",
      lastSeenDeviceTimezone: "America/Chicago",
    });
    mockDetectedTimezone("Asia/Tokyo");

    renderDialog();
    await user.click(screen.getByText("Set as default"));

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.timezones).toEqual(["Asia/Tokyo", "America/Chicago"]);
  });
});
