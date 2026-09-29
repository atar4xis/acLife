import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import { useCalendarSettings } from "../../src/context/CalendarSettingsContext.tsx";
import { seedSettings, readSettings } from "../settingsStorage.ts";


const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsStoreProvider>{children}</SettingsStoreProvider>
);

describe("useCalendarSettings", () => {
  it("throws when used outside a settings provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useCalendarSettings())).toThrow(
      "useSettingsStore must be used within a SettingsStoreProvider",
    );
    spy.mockRestore();
  });

  it("provides default settings when localStorage is empty", () => {
    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.defaultView).toBe("week");
    expect(result.current.weekStartsOn).toBe("inherit");
    expect(result.current.snapMinutes).toBe(5);
    expect(result.current.defaultEventName).toBe("new event");
    expect(result.current.defaultTaskName).toBe("new task");
    expect(result.current.defaultEventDuration).toBe(60);
    expect(result.current.resyncIntervalMinutes).toBe(5);
  });

  it("loads persisted settings from localStorage", () => {
    seedSettings({ weekStartsOn: "sun", snapMinutes: 15 });

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.weekStartsOn).toBe(7);
    expect(result.current.snapMinutes).toBe(15);
    // untouched fields still fall back to defaults
    expect(result.current.defaultView).toBe("week");
  });

  it("falls back to the default resync interval when stored value is falsy", () => {
    seedSettings({ resyncIntervalMinutes: 0 });

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.resyncIntervalMinutes).toBe(5);
  });

  it("recovers to defaults when stored JSON is malformed", () => {
    localStorage.setItem("acl-settings", "{not json");

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.defaultView).toBe("week");
    expect(result.current.weekStartsOn).toBe("inherit");
  });

  it("updates a setting and persists it to localStorage", () => {
    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    act(() => {
      result.current.setSetting("weekStartsOn", 7);
    });

    expect(result.current.weekStartsOn).toBe(7);
    expect(readSettings().weekStartsOn).toBe(
      7,
    );
  });

  it("updates one setting without clobbering the others", () => {
    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    act(() => {
      result.current.setSetting("snapMinutes", 10);
    });
    act(() => {
      result.current.setSetting("defaultEventName", "meeting");
    });

    expect(result.current.snapMinutes).toBe(10);
    expect(result.current.defaultEventName).toBe("meeting");
    expect(result.current.defaultTaskName).toBe("new task");
  });

  it("keeps each provider instance's state independent", () => {
    const { result: a } = renderHook(() => useCalendarSettings(), {
      wrapper,
    });
    const { result: b } = renderHook(() => useCalendarSettings(), {
      wrapper,
    });

    act(() => {
      a.current.setSetting("defaultTaskName", "todo");
    });

    expect(a.current.defaultTaskName).toBe("todo");
    expect(b.current.defaultTaskName).toBe("new task");
  });
});
