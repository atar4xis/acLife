import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DateTime, Settings } from "luxon";
import {
  CalendarSettingsProvider,
  useCalendarSettings,
} from "../../src/context/CalendarSettingsContext.tsx";
import { getDeviceTimezone } from "../../src/lib/calendar/timezone.ts";

const STORAGE_KEY = "acl-calendar-settings";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CalendarSettingsProvider>{children}</CalendarSettingsProvider>
);

describe("useCalendarSettings time zones", () => {
  it("defaults to the device time zone when localStorage is empty", () => {
    const { result } = renderHook(() => useCalendarSettings(), { wrapper });
    const deviceTimezone = getDeviceTimezone();

    expect(result.current.defaultTimezone).toBe(deviceTimezone);
    expect(result.current.timezones).toEqual([deviceTimezone]);
    expect(result.current.lastSeenDeviceTimezone).toBe(deviceTimezone);
  });

  it("loads persisted time zones from localStorage", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        timezones: ["Asia/Tokyo", "Europe/London"],
        defaultTimezone: "Asia/Tokyo",
      }),
    );

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.defaultTimezone).toBe("Asia/Tokyo");
    expect(result.current.timezones).toEqual(["Asia/Tokyo", "Europe/London"]);
  });

  it("falls back to the first time zone when the stored default isn't in the list", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        timezones: ["Asia/Tokyo", "Europe/London"],
        defaultTimezone: "America/Chicago",
      }),
    );

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.defaultTimezone).toBe("Asia/Tokyo");
  });

  it("falls back to the device time zone when the stored list is empty", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ timezones: [] }));

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.timezones).toEqual([getDeviceTimezone()]);
    expect(result.current.defaultTimezone).toBe(getDeviceTimezone());
  });

  it("reorders the stored list so the default time zone is always first", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        timezones: ["Europe/London", "Asia/Tokyo"],
        defaultTimezone: "Asia/Tokyo",
      }),
    );

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.timezones).toEqual(["Asia/Tokyo", "Europe/London"]);
  });

  it("drops an unresolvable persisted time zone like Factory and falls back to the device time zone", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ timezones: ["Factory"], defaultTimezone: "Factory" }),
    );

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });
    const deviceTimezone = getDeviceTimezone();

    expect(result.current.timezones).toEqual([deviceTimezone]);
    expect(result.current.defaultTimezone).toBe(deviceTimezone);
  });

  it("drops only the unresolvable entries, keeping valid additional time zones", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        timezones: ["Factory", "Asia/Tokyo"],
        defaultTimezone: "Factory",
      }),
    );

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.timezones).toEqual(["Asia/Tokyo"]);
    expect(result.current.defaultTimezone).toBe("Asia/Tokyo");
  });

  it("never sets Luxon's global default zone to an unresolvable persisted zone", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ timezones: ["Factory"], defaultTimezone: "Factory" }),
    );

    renderHook(() => useCalendarSettings(), { wrapper });

    expect(DateTime.now().isValid).toBe(true);
  });

  it("falls back to the default device time zone when lastSeenDeviceTimezone is missing", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ lastSeenDeviceTimezone: "" }),
    );

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.lastSeenDeviceTimezone).toBe(getDeviceTimezone());
  });

  it("updates Luxon's global default zone when the default time zone setting changes", () => {
    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    act(() => {
      result.current.setSetting("defaultTimezone", "Asia/Tokyo");
    });

    expect(Settings.defaultZone.name).toBe("Asia/Tokyo");
    expect(DateTime.now().zoneName).toBe("Asia/Tokyo");
  });

  it("persists time zone changes to localStorage", () => {
    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    act(() => {
      result.current.setSetting("timezones", ["Asia/Tokyo"]);
      result.current.setSetting("defaultTimezone", "Asia/Tokyo");
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.timezones).toEqual(["Asia/Tokyo"]);
    expect(stored.defaultTimezone).toBe("Asia/Tokyo");
  });
});
