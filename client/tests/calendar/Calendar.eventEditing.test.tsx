import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import {
  FIXED_NOW,
  buildPlainEvent,
  renderCalendar,
  advanceSave,
  getLastSavedEvents,
  getDayCell,
  openEventEditor,
  openEventMenu,
  dispatchWindowPointer,
  countEventBlocks,
  dayCenterX,
  timeToClientY,
  dragEvent,
  setupCalendarTests,
} from "./helpers";

setupCalendarTests();

describe("Calendar", () => {
  it("creates new event on correct day and time", async () => {
    const saveEvents = vi.fn();

    renderCalendar({ mode: "week", saveEvents });

    const cell = getDayCell(4);

    fireEvent.pointerDown(cell, {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(11, 27),
    });

    dispatchWindowPointer("pointerup", {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(11, 27),
    });

    expect(await screen.findByText("new event")).toBeInTheDocument();

    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].title).toBe("new event");
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("week")
        .plus({ days: 4, hours: 11, minutes: 25 })
        .toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("week")
        .plus({ days: 4, hours: 12, minutes: 25 })
        .toISO(),
    );
  });

  it("edits event title and description with keyboard save", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");

    const titleInput = screen.getByDisplayValue("Planning");
    const descriptionInput = screen.getByDisplayValue("Sprint planning");

    await user.clear(titleInput);
    await user.type(titleInput, "Refined planning");
    await user.clear(descriptionInput);
    await user.type(descriptionInput, "Updated agenda");
    await user.keyboard("{Control>}s{/Control}");

    await advanceSave();

    expect(await screen.findByText("Refined planning")).toBeInTheDocument();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].title).toBe("Refined planning");
    expect(savedEvents[0].description).toBe("Updated agenda");
  });

  it("edits event start and end time", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");

    fireEvent.change(screen.getByDisplayValue("09:00"), {
      target: { value: "11:15" },
    });
    fireEvent.change(screen.getByDisplayValue("10:00"), {
      target: { value: "12:45" },
    });

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 11, minutes: 15 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 12, minutes: 45 }).toISO(),
    );
    expect(await screen.findByText("11:15 AM - 12:45 PM")).toBeInTheDocument();
  });

  it("cancels edit without saving changes", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");

    // necessary at the moment because double clicking triggers save, remove when fixed
    await advanceSave();
    saveEvents.mockClear();

    const titleInput = screen.getByDisplayValue("Planning");
    await user.clear(titleInput);
    await user.type(titleInput, "Discarded title");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await advanceSave();

    expect(await screen.findByText("Planning")).toBeInTheDocument();
    expect(screen.queryByText("Discarded title")).not.toBeInTheDocument();
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("duplicates event from context menu", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventMenu(user, "Planning");
    await user.click(
      await screen.findByRole("menuitem", { name: /duplicate/i }),
    );

    await advanceSave();

    expect(countEventBlocks("Planning")).toBe(2);

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(2);
    expect(
      savedEvents.filter((event) => event.title === "Planning"),
    ).toHaveLength(2);
    expect(savedEvents[1].repeat).toBeUndefined();
  });

  it("deletes non-recurring event from context menu", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventMenu(user, "Planning");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    await advanceSave();

    expect(screen.queryByText("Planning")).not.toBeInTheDocument();
    expect(getLastSavedEvents(saveEvents)).toHaveLength(0);
  });

  it("moves event to another day", async () => {
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

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 9 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 10 }).toISO(),
    );
  });

  it("resizes event end", async () => {
    const saveEvents = vi.fn();

    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Planning",
      source: "resize_end",
      startX: dayCenterX(2),
      startY: timeToClientY(10),
      endX: dayCenterX(2),
      endY: timeToClientY(11),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 9 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 11 }).toISO(),
    );
  });

  it("resizes event start", async () => {
    const saveEvents = vi.fn();

    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Planning",
      source: "resize_start",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(2),
      endY: timeToClientY(8),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 8 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 10 }).toISO(),
    );
  });

  it("prevents resizing start past end", async () => {
    const saveEvents = vi.fn();

    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Planning",
      source: "resize_start",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(2),
      endY: timeToClientY(11),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day")
        .plus({ hours: 10 })
        .minus({ minutes: 5 })
        .toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 10 }).toISO(),
    );
  });

  it("prevents resizing end past start", async () => {
    const saveEvents = vi.fn();

    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Planning",
      source: "resize_end",
      startX: dayCenterX(2),
      startY: timeToClientY(10),
      endX: dayCenterX(2),
      endY: timeToClientY(8),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 9 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 9 }).plus({ minutes: 5 }).toISO(),
    );
  });

  it("rejects saving an event that would end before it starts", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");
    // double-clicking to open the editor triggers a spurious initial save
    await advanceSave();
    saveEvents.mockClear();

    fireEvent.change(screen.getByDisplayValue("09:00"), {
      target: { value: "11:00" },
    });

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    expect(toast.warning).toHaveBeenCalledWith(
      "An event cannot end before it starts.",
      expect.anything(),
    );
    expect(saveEvents).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();
  });

  it("rejects saving an event shorter than a minute", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");
    await advanceSave();
    saveEvents.mockClear();

    fireEvent.change(screen.getByDisplayValue("10:00"), {
      target: { value: "09:00" },
    });

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    expect(toast.warning).toHaveBeenCalledWith(
      "Invalid event duration.",
      expect.anything(),
    );
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("rejects saving an event longer than the maximum duration", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");
    await advanceSave();
    saveEvents.mockClear();

    const targetDay = FIXED_NOW.startOf("day").plus({ days: 29 });
    const [, endDateButton] = screen.getAllByRole("button", {
      name: "18 Mar 2026",
    });
    await user.click(endDateButton);
    // the target date is next month, so the picker needs to be paged forward
    await user.click(
      await screen.findByRole("button", { name: /go to the next month/i }),
    );

    const dayButton = await waitFor(() => {
      const el = document.querySelector(
        `[data-day="${targetDay.toISODate()}"] button`,
      ) as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    await user.click(dayButton);

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    expect(toast.warning).toHaveBeenCalledWith(
      "An event cannot last this long.",
      expect.anything(),
    );
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("rejects saving an event whose data is too large", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");
    await advanceSave();
    saveEvents.mockClear();

    fireEvent.change(screen.getByDisplayValue("Sprint planning"), {
      target: { value: "x".repeat(10_000) },
    });

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    expect(toast.warning).toHaveBeenCalledWith(
      "The event is too large.",
      expect.anything(),
    );
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("closes the editor without saving when pressing escape", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");
    await advanceSave();
    saveEvents.mockClear();

    const titleInput = screen.getByDisplayValue("Planning");
    await user.clear(titleInput);
    await user.type(titleInput, "Discarded title");
    await user.keyboard("{Escape}");
    await advanceSave();

    expect(
      screen.queryByRole("heading", { name: /edit event/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Discarded title")).not.toBeInTheDocument();
    expect(saveEvents).not.toHaveBeenCalled();
  });
});
