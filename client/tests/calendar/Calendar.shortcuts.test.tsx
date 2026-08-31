import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  FIXED_NOW,
  buildPlainEvent,
  buildSecondEvent,
  buildRecurringEvent,
  renderCalendar,
  advanceSave,
  getLastSavedEvents,
  getDayCell,
  openEventEditor,
  ctrlClickEvent,
  isSelected,
  getEventBlock,
  countEventBlocks,
  dayCenterX,
  timeToClientY,
  dragEvent,
  setupCalendarTests,
} from "./helpers";

const escapeKey = () => fireEvent.keyDown(window, { key: "Escape" });

setupCalendarTests();

describe("Calendar keyboard shortcuts", () => {
  it("deletes the event currently being edited on Delete", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");

    fireEvent.keyDown(window, { key: "Delete" });
    await advanceSave();

    expect(screen.queryByText("Planning")).not.toBeInTheDocument();
    expect(getLastSavedEvents(saveEvents)).toHaveLength(0);
  });

  it("clears editingEvent after deleting the event being edited", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });

    await openEventEditor(user, "Planning");

    fireEvent.keyDown(window, { key: "Delete" });
    await advanceSave();

    expect(screen.queryByText("Planning")).not.toBeInTheDocument();

    await ctrlClickEvent("Retro");
    expect(isSelected(await getEventBlock("Retro"))).toBe(true);

    escapeKey();

    expect(isSelected(await getEventBlock("Retro"))).toBe(false);
  });

  it("opens the recurring update dialog when deleting a recurring event being edited", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
    });

    await openEventEditor(user, "Daily standup");

    fireEvent.keyDown(window, { key: "Delete" });

    expect(
      await screen.findByText(/delete recurring event/i),
    ).toBeInTheDocument();
    expect(await getEventBlock("Daily standup")).toBeTruthy();
  });

  it("deletes selected events without a dialog, assuming 'this event'", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildRecurringEvent(), buildSecondEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Daily standup");
    await ctrlClickEvent("Retro");

    fireEvent.keyDown(window, { key: "Delete" });
    await advanceSave();

    expect(screen.queryByText(/recurring event/i)).not.toBeInTheDocument();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents.find((e) => e.title === "Retro")).toBeUndefined();

    const standup = savedEvents.find((e) => e.id === "repeat-parent");
    expect(standup?.start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 3, hours: 8 }).toISO(),
    );
  });

  it("undoes and redoes a moved event with ctrl+z / ctrl+y", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(4),
      endY: timeToClientY(9),
    });
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 9 }).toISO(),
    );

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 9 }).toISO(),
    );

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 9 }).toISO(),
    );

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await advanceSave();

    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 9 }).toISO(),
    );
  });

  it("does nothing on undo/redo when there's no history", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ events: [buildPlainEvent()], saveEvents });

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("copies and pastes selected events at the pointer location", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);

    fireEvent.keyDown(window, { key: "c", ctrlKey: true });

    fireEvent.pointerMove(getDayCell(4), {
      pointerId: 9,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(14),
    });

    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await advanceSave();

    expect(countEventBlocks("Planning")).toBe(2);

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(2);

    const pasted = savedEvents.find((e) => e.id !== "plain-event");
    expect(pasted?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 14 }).toISO(),
    );
    expect(pasted?.end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 15 }).toISO(),
    );
  });

  it("does nothing on paste without a prior copy", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ events: [buildPlainEvent()], saveEvents });

    fireEvent.pointerMove(getDayCell(0), {
      pointerId: 9,
      pointerType: "mouse",
      clientX: dayCenterX(0),
      clientY: timeToClientY(14),
    });

    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await advanceSave();

    expect(countEventBlocks("Planning")).toBe(1);
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("cuts selected events on ctrl+x, then pastes them at the pointer location", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");

    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    await advanceSave();

    expect(countEventBlocks("Planning")).toBe(0);
    expect(getLastSavedEvents(saveEvents)).toHaveLength(0);

    fireEvent.pointerMove(getDayCell(4), {
      pointerId: 9,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(14),
    });

    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await advanceSave();

    expect(countEventBlocks("Planning")).toBe(1);

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 14 }).toISO(),
    );
  });
});
