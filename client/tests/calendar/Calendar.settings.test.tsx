import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import {
  FIXED_NOW,
  advanceSave,
  dayCenterX,
  dispatchWindowPointer,
  getDayCell,
  getLastSavedEvents,
  renderCalendar,
  setupCalendarTests,
  timeToClientY,
} from "./helpers";

setupCalendarTests();

const STORAGE_KEY = "acl-calendar-settings";

const setCalendarSettings = (overrides: Record<string, unknown>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
};

describe("Calendar with custom settings", () => {
  it("renders the week starting on Sunday when weekStartsOn is Sunday", async () => {
    setCalendarSettings({ weekStartsOn: 7 });

    renderCalendar({ mode: "week" });

    const sundayStart = FIXED_NOW.startOf("week").minus({ days: 1 });
    const labels = Array.from({ length: 7 }, (_, i) =>
      sundayStart.plus({ days: i }).toFormat("EEE d"),
    );

    for (const label of labels) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  it("snaps newly created events to a custom snapMinutes value", async () => {
    setCalendarSettings({ snapMinutes: 15 });
    const saveEvents = vi.fn();

    renderCalendar({ mode: "week", saveEvents });

    const cell = getDayCell(4);

    fireEvent.pointerDown(cell, {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(11, 37),
    });

    dispatchWindowPointer("pointerup", {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(11, 37),
    });

    expect(await screen.findByText("new event")).toBeInTheDocument();
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    // minute 37 snapped down to the nearest 15 -> 30
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("week")
        .plus({ days: 4, hours: 11, minutes: 30 })
        .toISO(),
    );
  });

  it("uses a custom default event name for newly created events", async () => {
    setCalendarSettings({ defaultEventName: "focus block" });
    const saveEvents = vi.fn();

    renderCalendar({ mode: "week", saveEvents });

    const cell = getDayCell(4);

    fireEvent.pointerDown(cell, {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(11),
    });
    dispatchWindowPointer("pointerup", {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(11),
    });

    expect(await screen.findByText("focus block")).toBeInTheDocument();
    await advanceSave();
    expect(getLastSavedEvents(saveEvents)[0].title).toBe("focus block");
  });

  it("uses a custom default task name for newly created tasks", async () => {
    setCalendarSettings({ defaultTaskName: "todo item" });
    const saveEvents = vi.fn();

    renderCalendar({ mode: "week", saveEvents });

    const cell = getDayCell(4);

    fireEvent.pointerDown(cell, {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      altKey: true,
      clientX: dayCenterX(4),
      clientY: timeToClientY(11),
    });
    dispatchWindowPointer("pointerup", {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(11),
    });

    expect(await screen.findByText("todo item")).toBeInTheDocument();
    await advanceSave();
    expect(getLastSavedEvents(saveEvents)[0].title).toBe("todo item");
  });

  it("uses a custom default event duration for newly created events", async () => {
    setCalendarSettings({ defaultEventDuration: 90 });
    const saveEvents = vi.fn();

    renderCalendar({ mode: "week", saveEvents });

    const cell = getDayCell(4);

    fireEvent.pointerDown(cell, {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(11),
    });
    dispatchWindowPointer("pointerup", {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(11),
    });

    expect(await screen.findByText("new event")).toBeInTheDocument();
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    const duration = DateTime.fromISO(saved.end.toISO()!).diff(
      DateTime.fromISO(saved.start.toISO()!),
      "minutes",
    ).minutes;
    expect(duration).toBe(90);
  });
});
