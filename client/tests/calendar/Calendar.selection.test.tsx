import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import {
  FIXED_NOW,
  DAY_WIDTH,
  buildEvent,
  buildPlainEvent,
  buildSecondEvent,
  buildRecurringEvent,
  buildSecondRecurringEvent,
  renderCalendar,
  advanceSave,
  getLastSavedEvents,
  getEventBlock,
  openEventEditor,
  openEventMenu,
  pickCalendarDate,
  ctrlClickEvent,
  ctrlClickKey,
  isSelected,
  getSelectionBox,
  startSelectionBox,
  moveSelectionBox,
  endSelectionBox,
  dragSelectionBox,
  dispatchWindowPointer,
  dayCenterX,
  timeToClientY,
  dragEvent,
  countEventBlocks,
  setupCalendarTests,
} from "./helpers";

setupCalendarTests();

describe("Calendar", () => {
  it("toggles selection with ctrl + click", async () => {
    renderCalendar({ events: [buildPlainEvent()] });

    await ctrlClickEvent("Planning");
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);

    await ctrlClickEvent("Planning");
    expect(isSelected(await getEventBlock("Planning"))).toBe(false);
  });

  it("clears the selection when clicking an unselected event", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });

    await ctrlClickEvent("Planning");
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);

    const other = await getEventBlock("Retro");
    act(() => {
      fireEvent.pointerDown(other, {
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      });
    });
    dispatchWindowPointer("pointerup", { pointerId: 1, pointerType: "mouse" });

    expect(isSelected(await getEventBlock("Planning"))).toBe(false);
  });

  it("moves every selected event when dragging one of them", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(4),
      endY: timeToClientY(9),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 9 }).toISO(),
    );
    expect(retro?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 13 }).toISO(),
    );
    expect(retro?.end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 14 }).toISO(),
    );
  });

  it("deletes every selected event", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await openEventMenu(user, "Planning");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)).toHaveLength(0);
  });

  it("ctrl + drag on empty grid selects without creating an event", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await dragSelectionBox({
      startX: dayCenterX(0),
      startY: timeToClientY(1),
      endX: dayCenterX(6),
      endY: timeToClientY(20),
    });
    await advanceSave();

    expect(countEventBlocks("new event")).toBe(0);
  });

  it("deletes every selected repeating event", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent(), buildSecondRecurringEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Daily standup");
    await ctrlClickEvent("Weekly sync");

    expect(isSelected(await getEventBlock("Daily standup"))).toBe(true);
    expect(isSelected(await getEventBlock("Weekly sync"))).toBe(true);

    await openEventMenu(user, "Daily standup");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);

    const standup = savedEvents.find((e) => e.id === "repeat-parent");
    const sync = savedEvents.find((e) => e.id === "repeat-parent-2");

    expect(standup?.start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 3, hours: 8 }).toISO(),
    );
    expect(sync?.start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 3, hours: 14 }).toISO(),
    );
  });

  it("moves every selected repeating event", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildRecurringEvent(), buildSecondRecurringEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Daily standup");
    await ctrlClickEvent("Weekly sync");

    await dragEvent({
      title: "Daily standup",
      startX: dayCenterX(2),
      startY: timeToClientY(8),
      endX: dayCenterX(4),
      endY: timeToClientY(8),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);

    const detached = savedEvents.filter(
      (e) => e.id !== "repeat-parent" && e.id !== "repeat-parent-2",
    );

    expect(detached).toHaveLength(2);
    expect(detached.map((e) => e.start.hour).sort((a, b) => a - b)).toEqual([
      8, 14,
    ]);
  });

  it("deletes several occurrences of the same repeating event", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await ctrlClickKey("repeat-parent_2026-03-19");
    await ctrlClickKey("repeat-parent_2026-03-20");

    const target = document.querySelector(
      '[data-event-key="repeat-parent_2026-03-19"]',
    ) as HTMLElement;

    await user.pointer({ target, keys: "[MouseRight]" });
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const parent = savedEvents.find((e) => e.id === "repeat-parent");

    expect(parent?.repeat?.skip).toEqual(
      expect.arrayContaining(["2026-03-19", "2026-03-20"]),
    );
  });

  it("applies editor changes to every selected event", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

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
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.repeat).toEqual({ interval: 1, unit: "day" });
    expect(retro?.repeat).toEqual({ interval: 1, unit: "day" });
    expect(retro?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 13 }).toISO(),
    );
  });

  it("applies task changes from the editor to every selected event", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await openEventEditor(user, "Planning");

    await user.click(screen.getByRole("checkbox", { name: /task/i }));
    await user.click(screen.getByRole("checkbox", { name: /completed/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.isTask).toBe(true);
    expect(planning?.completed).toBe(true);
    expect(retro?.isTask).toBe(true);
    expect(retro?.completed).toBe(true);
  });

  it("completing one selected task from its block checkbox completes every selected event", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [
        buildEvent({ isTask: true }),
        buildEvent({
          id: "second-event",
          title: "Retro",
          description: undefined,
          isTask: true,
          start: FIXED_NOW.startOf("day").plus({ hours: 13 }),
          end: FIXED_NOW.startOf("day").plus({ hours: 14 }),
        }),
      ],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    const block = await getEventBlock("Planning");
    fireEvent.click(within(block).getByRole("checkbox"));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.completed).toBe(true);
    expect(retro?.completed).toBe(true);
  });

  it("changing only the time keeps every selected event on its own day", async () => {
    const saveEvents = vi.fn();
    const retroDay = FIXED_NOW.startOf("day").plus({ days: 1 });
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildPlainEvent(),
        buildEvent({
          id: "second-event",
          title: "Retro",
          description: undefined,
          start: retroDay.plus({ hours: 13 }),
          end: retroDay.plus({ hours: 14 }),
        }),
      ],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await openEventEditor(user, "Planning");

    fireEvent.change(screen.getByDisplayValue("09:00"), {
      target: { value: "03:00" },
    });

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.start.toFormat("HH:mm")).toBe("03:00");
    expect(retro?.start.toFormat("HH:mm")).toBe("03:00");

    expect(retro?.start.hasSame(retroDay, "day")).toBe(true);
    expect(retro?.end.toFormat("HH:mm")).toBe("14:00");
  });

  it("changing only the date moves every selected event to that date, keeping each event's own time", async () => {
    const saveEvents = vi.fn();
    const retroDay = FIXED_NOW.startOf("day").plus({ days: 1 });
    const targetDay = FIXED_NOW.startOf("day").plus({ days: 7 });
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildPlainEvent(),
        buildEvent({
          id: "second-event",
          title: "Retro",
          description: undefined,
          start: retroDay.plus({ hours: 13 }),
          end: retroDay.plus({ hours: 14 }),
        }),
      ],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await openEventEditor(user, "Planning");

    const [startDateButton, endDateButton] = screen.getAllByRole("button", {
      name: "18 Mar 2026",
    });

    await pickCalendarDate(user, startDateButton, targetDay);
    await pickCalendarDate(user, endDateButton, targetDay);

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.start.hasSame(targetDay, "day")).toBe(true);
    expect(planning?.start.toFormat("HH:mm")).toBe("09:00");
    expect(planning?.end.toFormat("HH:mm")).toBe("10:00");

    expect(retro?.start.hasSame(targetDay, "day")).toBe(true);
    expect(retro?.start.toFormat("HH:mm")).toBe("13:00");
    expect(retro?.end.hasSame(targetDay, "day")).toBe(true);
    expect(retro?.end.toFormat("HH:mm")).toBe("14:00");
  });

  it("changing both date and time moves every selected event to that exact date and time", async () => {
    const saveEvents = vi.fn();
    const retroDay = FIXED_NOW.startOf("day").plus({ days: 1 });
    const targetDay = FIXED_NOW.startOf("day").plus({ days: 2 });
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildPlainEvent(),
        buildEvent({
          id: "second-event",
          title: "Retro",
          description: undefined,
          start: retroDay.plus({ hours: 13 }),
          end: retroDay.plus({ hours: 14 }),
        }),
      ],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await openEventEditor(user, "Planning");

    const [startDateButton, endDateButton] = screen.getAllByRole("button", {
      name: "18 Mar 2026",
    });

    await pickCalendarDate(user, startDateButton, targetDay);
    await pickCalendarDate(user, endDateButton, targetDay);

    fireEvent.change(screen.getByDisplayValue("09:00"), {
      target: { value: "03:00" },
    });
    fireEvent.change(screen.getByDisplayValue("10:00"), {
      target: { value: "04:00" },
    });

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.start.toISO()).toBe(targetDay.plus({ hours: 3 }).toISO());
    expect(planning?.end.toISO()).toBe(targetDay.plus({ hours: 4 }).toISO());

    expect(retro?.start.toISO()).toBe(planning?.start.toISO());
    expect(retro?.end.toISO()).toBe(planning?.end.toISO());
  });

  it("selects only the events the box covers", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });

    await dragSelectionBox({
      startX: dayCenterX(2) - DAY_WIDTH / 4,
      startY: timeToClientY(8),
      endX: dayCenterX(2) + DAY_WIDTH / 4,
      endY: timeToClientY(11),
    });

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(false);
  });

  it("keeps the box visible while dragging and removes it on release", async () => {
    renderCalendar({ mode: "week", events: [buildPlainEvent()] });

    startSelectionBox({ x: dayCenterX(2), y: timeToClientY(8) });
    moveSelectionBox({ x: dayCenterX(4), y: timeToClientY(12) });

    const box = getSelectionBox();
    expect(box).toBeTruthy();
    expect(box!.style.left).toBe(`${dayCenterX(2)}px`);
    expect(box!.style.top).toBe(`${timeToClientY(8)}px`);
    expect(box!.style.width).toBe(`${dayCenterX(4) - dayCenterX(2)}px`);
    expect(box!.style.height).toBe(`${timeToClientY(12) - timeToClientY(8)}px`);

    endSelectionBox({ x: dayCenterX(4), y: timeToClientY(12) });

    expect(getSelectionBox()).toBeNull();
  });

  it("removes selection box when pointermove and pointerup land in the same batch", () => {
    renderCalendar({ mode: "week", events: [buildPlainEvent()] });

    startSelectionBox({ x: dayCenterX(2), y: timeToClientY(8) });
    moveSelectionBox({ x: dayCenterX(4), y: timeToClientY(12) });
    expect(getSelectionBox()).toBeTruthy();

    const release = { x: dayCenterX(4) + 1, y: timeToClientY(12) };
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          pointerType: "mouse",
          ctrlKey: true,
          clientX: release.x,
          clientY: release.y,
        }),
      );

      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          pointerType: "mouse",
          ctrlKey: true,
          clientX: release.x,
          clientY: release.y,
        }),
      );
    });

    expect(getSelectionBox()).toBeNull();
  });

  it("box selection adds to an existing ctrl + click selection", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });

    await ctrlClickEvent("Retro");

    await dragSelectionBox({
      startX: dayCenterX(2) - DAY_WIDTH / 4,
      startY: timeToClientY(8),
      endX: dayCenterX(2) + DAY_WIDTH / 4,
      endY: timeToClientY(11),
    });

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(true);
  });

  it("moves every event caught by the box", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await dragSelectionBox({
      startX: dayCenterX(2) - DAY_WIDTH / 4,
      startY: timeToClientY(8),
      endX: dayCenterX(2) + DAY_WIDTH / 4,
      endY: timeToClientY(15),
    });

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(3),
      endY: timeToClientY(9),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 9 }).toISO(),
    );
    expect(retro?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 13 }).toISO(),
    );
  });

  it("starts a selection box from an event block", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });

    startSelectionBox({
      from: await getEventBlock("Planning"),
      x: dayCenterX(2),
      y: timeToClientY(9, 30),
    });
    moveSelectionBox({ x: dayCenterX(2), y: timeToClientY(14) });

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(true);
    expect(getSelectionBox()).toBeTruthy();

    endSelectionBox({ x: dayCenterX(2), y: timeToClientY(14) });

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(true);
  });

  it("does not move an event when ctrl + dragging from it", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragSelectionBox({
      from: await getEventBlock("Planning"),
      startX: dayCenterX(2),
      startY: timeToClientY(9, 30),
      endX: dayCenterX(4),
      endY: timeToClientY(14),
    });
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
  });

  it("updates the highlight live as the box grows and shrinks", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });

    startSelectionBox({ x: dayCenterX(2), y: timeToClientY(8) });

    moveSelectionBox({ x: dayCenterX(2), y: timeToClientY(14) });
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(true);

    moveSelectionBox({ x: dayCenterX(2), y: timeToClientY(11) });
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(false);

    endSelectionBox({ x: dayCenterX(2), y: timeToClientY(11) });
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(false);
  });

  it("ctrl + press on an event toggles it when the pointer barely moves", async () => {
    renderCalendar({ mode: "week", events: [buildPlainEvent()] });

    startSelectionBox({
      from: await getEventBlock("Planning"),
      x: dayCenterX(2),
      y: timeToClientY(9, 30),
    });
    moveSelectionBox({ x: dayCenterX(2) + 2, y: timeToClientY(9, 30) });
    endSelectionBox({ x: dayCenterX(2) + 2, y: timeToClientY(9, 30) });

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
  });
});
