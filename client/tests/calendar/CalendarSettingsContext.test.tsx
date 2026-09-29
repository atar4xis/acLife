import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  CalendarSettingsProvider,
  useCalendarSettings,
} from "../../src/context/CalendarSettingsContext.tsx";

const STORAGE_KEY = "acl-calendar-settings";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CalendarSettingsProvider>{children}</CalendarSettingsProvider>
);

describe("useCalendarSettings", () => {
  it("throws when used outside a CalendarSettingsProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useCalendarSettings())).toThrow(
      "useCalendarSettings must be used within a CalendarSettingsProvider",
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
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ weekStartsOn: "sun", snapMinutes: 15 }),
    );

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.weekStartsOn).toBe(7);
    expect(result.current.snapMinutes).toBe(15);
    // untouched fields still fall back to defaults
    expect(result.current.defaultView).toBe("week");
  });

  it("falls back to the default resync interval when stored value is falsy", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ resyncIntervalMinutes: 0 }),
    );

    const { result } = renderHook(() => useCalendarSettings(), { wrapper });

    expect(result.current.resyncIntervalMinutes).toBe(5);
  });

  it("recovers to defaults when stored JSON is malformed", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");

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
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).weekStartsOn).toBe(
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
