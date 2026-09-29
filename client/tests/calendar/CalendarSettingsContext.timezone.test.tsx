import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DateTime, Settings } from "luxon";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import { useCalendarSettings } from "../../src/context/CalendarSettingsContext.tsx";
import { getDeviceTimezone } from "../../src/lib/calendar/timezone.ts";
import { seedSettings, readSettings } from "../settingsStorage.ts";


const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsStoreProvider>{children}</SettingsStoreProvider>
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
    seedSettings({
        timezones: ["Asia/Tokyo", "Europe/London"],
        defaultTimezone: "Asia/Tokyo",
      });

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.defaultTimezone).toBe("Asia/Tokyo");
    expect(result.current.timezones).toEqual(["Asia/Tokyo", "Europe/London"]);
  });

  it("falls back to the first time zone when the stored default isn't in the list", () => {
    seedSettings({
        timezones: ["Asia/Tokyo", "Europe/London"],
        defaultTimezone: "America/Chicago",
      });

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.defaultTimezone).toBe("Asia/Tokyo");
  });

  it("falls back to the device time zone when the stored list is empty", () => {
    seedSettings({ timezones: [] });

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.timezones).toEqual([getDeviceTimezone()]);
    expect(result.current.defaultTimezone).toBe(getDeviceTimezone());
  });

  it("reorders the stored list so the default time zone is always first", () => {
    seedSettings({
        timezones: ["Europe/London", "Asia/Tokyo"],
        defaultTimezone: "Asia/Tokyo",
      });

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.timezones).toEqual(["Asia/Tokyo", "Europe/London"]);
  });

  it("drops an unresolvable persisted time zone like Factory and falls back to the device time zone", () => {
    seedSettings({ timezones: ["Factory"], defaultTimezone: "Factory" });

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });
    const deviceTimezone = getDeviceTimezone();

    expect(result.current.timezones).toEqual([deviceTimezone]);
    expect(result.current.defaultTimezone).toBe(deviceTimezone);
  });

  it("drops only the unresolvable entries, keeping valid additional time zones", () => {
    seedSettings({
        timezones: ["Factory", "Asia/Tokyo"],
        defaultTimezone: "Factory",
      });

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.timezones).toEqual(["Asia/Tokyo"]);
    expect(result.current.defaultTimezone).toBe("Asia/Tokyo");
  });

  it("never sets Luxon's global default zone to an unresolvable persisted zone", () => {
    seedSettings({ timezones: ["Factory"], defaultTimezone: "Factory" });

    renderHook(() => useCalendarSettings(), { wrapper });

    expect(DateTime.now().isValid).toBe(true);
  });

  it("falls back to the default device time zone when lastSeenDeviceTimezone is missing", () => {
    seedSettings({ lastSeenDeviceTimezone: "" });

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

    const stored = readSettings();
    expect(stored.timezones).toEqual(["Asia/Tokyo"]);
    expect(stored.defaultTimezone).toBe("Asia/Tokyo");
  });
});
