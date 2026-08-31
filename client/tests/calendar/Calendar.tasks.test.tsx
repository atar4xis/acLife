import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import {
  buildEvent,
  buildPlainEvent,
  buildRecurringEvent,
  renderCalendar,
  advanceSave,
  getLastSavedEvents,
  getEventBlock,
  getDayCell,
  openEventEditor,
  dispatchWindowPointer,
  dayCenterX,
  timeToClientY,
  setupCalendarTests,
} from "./helpers";

setupCalendarTests();

describe("Calendar", () => {
  it("shows completed checkbox in the editor only when marked as a task", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });

    await openEventEditor(user, "Planning");

    expect(screen.getByRole("checkbox", { name: /task/i })).not.toBeChecked();
    expect(
      screen.queryByRole("checkbox", { name: /completed/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /task/i }));

    expect(
      screen.getByRole("checkbox", { name: /completed/i }),
    ).toBeInTheDocument();
  });

  it("saves isTask and completed when marking an event as a completed task", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");

    await user.click(screen.getByRole("checkbox", { name: /task/i }));
    await user.click(screen.getByRole("checkbox", { name: /completed/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].isTask).toBe(true);
    expect(savedEvents[0].completed).toBe(true);
  });

  it("clears completed when a task is unmarked as a task", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildEvent({ isTask: true, completed: true })],
      saveEvents,
    });

    await openEventEditor(user, "Planning");

    await user.click(screen.getByRole("checkbox", { name: /task/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].isTask).toBe(false);
    expect(savedEvents[0].completed).toBeUndefined();
  });

  it("creates a task when holding alt while adding a new event", async () => {
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

    expect(await screen.findByText("new task")).toBeInTheDocument();

    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].title).toBe("new task");
    expect(savedEvents[0].isTask).toBe(true);
  });

  it("toggles a task's completion from the checkbox on the event block without opening the editor", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildEvent({ isTask: true })],
      saveEvents,
    });

    const block = await getEventBlock("Planning");
    await user.click(within(block).getByRole("checkbox"));
    await advanceSave();

    expect(
      screen.queryByRole("heading", { name: /edit event/i }),
    ).not.toBeInTheDocument();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].completed).toBe(true);
  });

  it("does not render a completion checkbox on a non-task event block", async () => {
    renderCalendar({ events: [buildPlainEvent()] });

    const block = await getEventBlock("Planning");
    expect(within(block).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("dims and strikes through a completed task on the event block", async () => {
    renderCalendar({
      events: [buildEvent({ isTask: true, completed: true })],
    });

    const block = await getEventBlock("Planning");
    expect(block.className).toContain("opacity-50");

    const title = screen.getByText("Planning");
    expect(title.className).toContain("line-through");
  });

  it("completes a single occurrence of a recurring task without prompting and without detaching it", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent({ isTask: true })],
      saveEvents,
    });

    const instanceBlock = document.querySelector(
      '[data-event-key="repeat-parent_2026-03-19"]',
    ) as HTMLElement;
    expect(instanceBlock).toBeTruthy();

    await user.click(within(instanceBlock).getByRole("checkbox"));
    await advanceSave();

    expect(
      screen.queryByText(/update recurring event/i),
    ).not.toBeInTheDocument();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].id).toBe("repeat-parent");
    expect(savedEvents[0].completedInstances).toEqual(["2026-03-19"]);
  });

  it("removes an occurrence from completedInstances when unchecked", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildRecurringEvent({
          isTask: true,
          completedInstances: ["2026-03-18", "2026-03-19"],
        }),
      ],
      saveEvents,
    });

    const instanceBlock = document.querySelector(
      '[data-event-key="repeat-parent_2026-03-19"]',
    ) as HTMLElement;

    await user.click(within(instanceBlock).getByRole("checkbox"));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].completedInstances).toEqual(["2026-03-18"]);
  });

  it("completes the parent occurrence of a recurring task in place", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildRecurringEvent({ isTask: true })],
      saveEvents,
    });

    const block = await getEventBlock("Daily standup");
    await user.click(within(block).getByRole("checkbox"));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].id).toBe("repeat-parent");
    expect(savedEvents[0].completedInstances).toEqual(["2026-03-18"]);
  });

  it("clears completedInstances when a recurring task's repeat is turned off", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [
        buildRecurringEvent({
          isTask: true,
          completedInstances: ["2026-03-18"],
        }),
      ],
      saveEvents,
    });

    await openEventEditor(user, "Daily standup");

    const repeatTrigger = screen
      .getAllByText("Repeat daily")
      .map((node) => node.closest("button"))
      .find(Boolean) as HTMLElement;

    await user.click(repeatTrigger);
    await user.click(
      await screen.findByRole("option", { name: /does not repeat/i }),
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].repeat).toBeUndefined();
    expect(savedEvents[0].completedInstances).toBeUndefined();
    expect(savedEvents[0].completed).toBe(true);
  });

  it("seeds completedInstances with the first occurrence when a completed task starts repeating", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildEvent({ isTask: true, completed: true })],
      saveEvents,
    });

    await openEventEditor(user, "Planning");

    const repeatTrigger = screen
      .getAllByText("Does not repeat")
      .map((node) => node.closest("button"))
      .find(Boolean) as HTMLElement;

    await user.click(repeatTrigger);
    await user.click(
      await screen.findByRole("option", { name: /^repeat daily$/i }),
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].repeat).toEqual({ interval: 1, unit: "day" });
    expect(savedEvents[0].completedInstances).toEqual(["2026-03-18"]);
  });
});
