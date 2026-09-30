import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import {
  FIXED_NOW,
  advanceSave,
  buildPlainEvent,
  dispatchWindowPointer,
  getDayCell,
  dayCenterX,
  dragEvent,
  getLastSavedEvents,
  renderCalendar,
  setupCalendarTests,
  timeToClientY,
} from "./helpers";

setupCalendarTests();

const day = FIXED_NOW.startOf("day");

describe("settings apply immediately", () => {
  it("snaps the very next drag to a snapMinutes value changed while mounted", async () => {
    const saveEvents = vi.fn();
    const { store } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    act(() => store.setSetting("snapMinutes", 60));

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(2),
      endY: timeToClientY(10, 22),
    });
    await advanceSave();

    // 82 minutes down snaps to 60, not to the previous 5 minute step
    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      day.plus({ hours: 10 }).toISO(),
    );
  });

  it("snaps the very next resize to a snapMinutes value changed while mounted", async () => {
    const saveEvents = vi.fn();
    const { store } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    act(() => store.setSetting("snapMinutes", 60));

    await dragEvent({
      title: "Planning",
      source: "resize_end",
      startX: dayCenterX(2),
      startY: timeToClientY(10),
      endX: dayCenterX(2),
      endY: timeToClientY(11, 22),
    });
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].end.toISO()).toBe(
      day.plus({ hours: 11 }).toISO(),
    );
  });

  it("snaps a newly created event to a snapMinutes value changed while mounted", async () => {
    const saveEvents = vi.fn();
    const { store } = renderCalendar({ mode: "week", saveEvents });

    act(() => store.setSetting("snapMinutes", 60));

    const point = { clientX: dayCenterX(4), clientY: timeToClientY(11, 37) };
    fireEvent.pointerDown(getDayCell(4), {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      ...point,
    });
    dispatchWindowPointer("pointerup", {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      ...point,
    });

    expect(await screen.findByText("new event")).toBeInTheDocument();
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 4, hours: 11 }).toISO(),
    );
  });
});
