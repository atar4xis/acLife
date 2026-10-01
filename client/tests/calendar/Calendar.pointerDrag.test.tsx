import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import {
  FIXED_NOW,
  advanceSave,
  buildEvent,
  buildPlainEvent,
  buildRecurringEvent,
  buildSecondEvent,
  ctrlClickEvent,
  dayCenterX,
  dispatchWindowPointer,
  dragEvent,
  getEventBlock,
  getLastSavedEvents,
  renderCalendar,
  setupCalendarTests,
  timeToClientY,
} from "./helpers";
import { seedSettings } from "../settingsStorage.ts";

setupCalendarTests();

const day = FIXED_NOW.startOf("day");
const week = FIXED_NOW.startOf("week");

const byId = <T extends { id: string }>(events: T[], id: string) =>
  events.find((e) => e.id === id)!;

describe("pointer drag: move", () => {
  it("moves within a day, snapping to snapMinutes", async () => {
    seedSettings({ snapMinutes: 15 });
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(2),
      endY: timeToClientY(10, 22),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    // 82 minutes down snaps to 75
    expect(saved.start.toISO()).toBe(
      day.plus({ hours: 10, minutes: 15 }).toISO(),
    );
    expect(saved.end.toISO()).toBe(
      day.plus({ hours: 11, minutes: 15 }).toISO(),
    );
  });

  it("moves across days keeping the time", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(0),
      endY: timeToClientY(9),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    expect(saved.start.toISO()).toBe(
      day.minus({ days: 2 }).plus({ hours: 9 }).toISO(),
    );
    expect(saved.end.toISO()).toBe(
      day.minus({ days: 2 }).plus({ hours: 10 }).toISO(),
    );
  });

  it("moves across days and time at once", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(3),
      endY: timeToClientY(8, 30),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    expect(saved.start.toISO()).toBe(
      day.plus({ days: 1, hours: 8, minutes: 30 }).toISO(),
    );
    expect(saved.end.toISO()).toBe(
      day.plus({ days: 1, hours: 9, minutes: 30 }).toISO(),
    );
  });

  it("does not save or change anything for a press without movement", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(2),
      endY: timeToClientY(9),
    });
    await advanceSave();

    for (const [events] of saveEvents.mock.calls)
      expect(events[0].start.toISO()).toBe(day.plus({ hours: 9 }).toISO());
  });

  it("undoes a drop with a single undo", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(4),
      endY: timeToClientY(11),
    });
    await advanceSave();
    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      day.plus({ days: 2, hours: 11 }).toISO(),
    );

    await user.keyboard("{Control>}z{/Control}");
    await advanceSave();
    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      day.plus({ hours: 9 }).toISO(),
    );

    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    await advanceSave();
    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      day.plus({ days: 2, hours: 11 }).toISO(),
    );
  });

  it("keeps a task's completion state when it is moved", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      saveEvents,
      events: [
        buildEvent({
          id: "task",
          title: "Pay rent",
          isTask: true,
          completed: true,
        }),
      ],
    });

    await dragEvent({
      title: "Pay rent",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(3),
      endY: timeToClientY(9),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    expect(saved).toMatchObject({ isTask: true, completed: true });
    expect(saved.start.toISO()).toBe(day.plus({ days: 1, hours: 9 }).toISO());
  });

  it("moves a multi-day event as a whole", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      saveEvents,
      events: [
        buildEvent({
          id: "trip",
          title: "Trip",
          start: day.plus({ hours: 22 }),
          end: day.plus({ days: 1, hours: 2 }),
        }),
      ],
    });

    await dragEvent({
      title: "Trip",
      startX: dayCenterX(2),
      startY: timeToClientY(22),
      endX: dayCenterX(2),
      endY: timeToClientY(21),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    expect(saved.start.toISO()).toBe(day.plus({ hours: 21 }).toISO());
    expect(saved.end.toISO()).toBe(day.plus({ days: 1, hours: 1 }).toISO());
  });
});

describe("pointer drag: resize", () => {
  it("moves the end", async () => {
    seedSettings({ snapMinutes: 15 });
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await dragEvent({
      title: "Planning",
      source: "resize_end",
      startX: dayCenterX(2),
      startY: timeToClientY(10),
      endX: dayCenterX(2),
      endY: timeToClientY(10, 37),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    expect(saved.start.toISO()).toBe(day.plus({ hours: 9 }).toISO());
    expect(saved.end.toISO()).toBe(
      day.plus({ hours: 10, minutes: 30 }).toISO(),
    );
  });

  it("moves the start", async () => {
    seedSettings({ snapMinutes: 15 });
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await dragEvent({
      title: "Planning",
      source: "resize_start",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(2),
      endY: timeToClientY(8, 22),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    // 38 minutes up snaps to 45
    expect(saved.start.toISO()).toBe(
      day.plus({ hours: 8, minutes: 15 }).toISO(),
    );
    expect(saved.end.toISO()).toBe(day.plus({ hours: 10 }).toISO());
  });

  it("keeps a minimum duration of one snap when the end is dragged above the start", async () => {
    seedSettings({ snapMinutes: 15 });
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await dragEvent({
      title: "Planning",
      source: "resize_end",
      startX: dayCenterX(2),
      startY: timeToClientY(10),
      endX: dayCenterX(2),
      endY: timeToClientY(7),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    expect(saved.start.toISO()).toBe(day.plus({ hours: 9 }).toISO());
    expect(saved.end.toISO()).toBe(day.plus({ hours: 9, minutes: 15 }).toISO());
  });

  it("keeps a minimum duration of one snap when the start is dragged below the end", async () => {
    seedSettings({ snapMinutes: 15 });
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await dragEvent({
      title: "Planning",
      source: "resize_start",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(2),
      endY: timeToClientY(12),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    expect(saved.start.toISO()).toBe(
      day.plus({ hours: 9, minutes: 45 }).toISO(),
    );
    expect(saved.end.toISO()).toBe(day.plus({ hours: 10 }).toISO());
  });

  it("lets the end cross into the next day", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await dragEvent({
      title: "Planning",
      source: "resize_end",
      startX: dayCenterX(2),
      startY: timeToClientY(10),
      endX: dayCenterX(3),
      endY: timeToClientY(10),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    expect(saved.start.toISO()).toBe(day.plus({ hours: 9 }).toISO());
    expect(saved.end.toISO()).toBe(day.plus({ days: 1, hours: 10 }).toISO());
  });

  it("undoes a resize with a single undo", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
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
      endY: timeToClientY(12),
    });
    await advanceSave();
    await user.keyboard("{Control>}z{/Control}");
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].end.toISO()).toBe(
      day.plus({ hours: 10 }).toISO(),
    );
  });
});

describe("pointer drag: selection", () => {
  it("moves the whole selection with one history entry", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
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
      endX: dayCenterX(3),
      endY: timeToClientY(10),
    });
    await advanceSave();

    let saved = getLastSavedEvents(saveEvents);
    expect(byId(saved, "plain-event").start.toISO()).toBe(
      day.plus({ days: 1, hours: 10 }).toISO(),
    );
    expect(byId(saved, "second-event").start.toISO()).toBe(
      day.plus({ days: 1, hours: 14 }).toISO(),
    );

    await user.keyboard("{Control>}z{/Control}");
    await advanceSave();
    saved = getLastSavedEvents(saveEvents);
    expect(byId(saved, "plain-event").start.toISO()).toBe(
      day.plus({ hours: 9 }).toISO(),
    );
    expect(byId(saved, "second-event").start.toISO()).toBe(
      day.plus({ hours: 13 }).toISO(),
    );
  });

  it("stops blocking touch scrolling once a touch selection drag ends", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });
    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    const touch = {
      button: 0,
      pointerId: 7,
      pointerType: "touch",
      clientX: dayCenterX(2),
      clientY: timeToClientY(9),
    };
    fireEvent.pointerDown(await getEventBlock("Planning"), touch);
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    dispatchWindowPointer("pointermove", {
      ...touch,
      clientY: timeToClientY(10),
    });
    dispatchWindowPointer("pointerup", touch);

    const scroll = new Event("touchmove", { cancelable: true });
    window.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
  });

  it("does not save for a press without movement on a selected event", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });
    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");
    await advanceSave();
    const saves = saveEvents.mock.calls.length;

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(2),
      endY: timeToClientY(9),
    });
    await advanceSave();

    expect(saveEvents).toHaveBeenCalledTimes(saves);
  });

  it("clears the selection when a selected recurring event is detached", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildRecurringEvent()],
    });
    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Daily standup");
    expect(await getEventBlock("Planning")).toHaveAccessibleName(/selected/);

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(2),
      endY: timeToClientY(10),
    });
    await advanceSave();

    expect(await getEventBlock("Planning")).not.toHaveAccessibleName(
      /selected/,
    );
  });

  it("clears the selection when an unselected event is dragged", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });
    await ctrlClickEvent("Planning");

    await dragEvent({
      title: "Retro",
      startX: dayCenterX(2),
      startY: timeToClientY(13),
      endX: dayCenterX(3),
      endY: timeToClientY(13),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(byId(saved, "plain-event").start.toISO()).toBe(
      day.plus({ hours: 9 }).toISO(),
    );
    expect(byId(saved, "second-event").start.toISO()).toBe(
      day.plus({ days: 1, hours: 13 }).toISO(),
    );
  });

  it("resizes every selected event when a selected event's handle is dragged", async () => {
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
      source: "resize_end",
      startX: dayCenterX(2),
      startY: timeToClientY(10),
      endX: dayCenterX(2),
      endY: timeToClientY(11),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(byId(saved, "plain-event").end.toISO()).toBe(
      day.plus({ hours: 11 }).toISO(),
    );
    expect(byId(saved, "second-event").end.toISO()).toBe(
      day.plus({ hours: 15 }).toISO(),
    );
  });
});

describe("pointer drag: recurring events", () => {
  const dropRecurring = async () => {
    await dragEvent({
      title: "Daily standup",
      startX: dayCenterX(2),
      startY: timeToClientY(8),
      endX: dayCenterX(2),
      endY: timeToClientY(10),
    });
    return screen.findByText(/update recurring event/i);
  };

  it("asks what to update and detaches the occurrence for 'this event'", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });
    await dropRecurring();
    await user.click(screen.getByRole("radio", { name: /this event/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(2);
    const detached = saved.find((e) => e.id !== "repeat-parent")!;
    expect(detached.start.toISO()).toBe(
      week.plus({ days: 2, hours: 10 }).toISO(),
    );
    expect(detached.repeat).toBeUndefined();
  });

  it("updates every occurrence for 'all events'", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });
    await dropRecurring();
    await user.click(screen.getByRole("radio", { name: /all events/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(saved[0].start.toISO()).toBe(
      week.plus({ days: 2, hours: 10 }).toISO(),
    );
    expect(saved[0].repeat).toBeDefined();
  });

  it("restores the original position when the dialog is cancelled", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });
    await dropRecurring();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
    const block = await getEventBlock("Daily standup");
    expect(block.style.top).toBe("480px");
  });

  it("undoes a confirmed recurring update with a single undo", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });
    await dropRecurring();
    await user.click(screen.getByRole("radio", { name: /all events/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();
    await user.keyboard("{Control>}z{/Control}");
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      week.plus({ days: 2, hours: 8 }).toISO(),
    );
  });
});

describe("pointer drag: block identity", () => {
  it("keeps every block mounted while one is dragged and dropped", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });
    const planning = await getEventBlock("Planning");
    const retro = await getEventBlock("Retro");
    const pointer = { button: 0, pointerId: 1, pointerType: "mouse" } as const;

    fireEvent.pointerDown(planning, {
      ...pointer,
      clientX: dayCenterX(2),
      clientY: timeToClientY(9),
    });
    dispatchWindowPointer("pointermove", {
      ...pointer,
      clientX: dayCenterX(2),
      clientY: timeToClientY(10, 22),
    });

    expect(planning.isConnected).toBe(true);
    expect(retro.isConnected).toBe(true);

    dispatchWindowPointer("pointerup", {
      ...pointer,
      clientX: dayCenterX(2),
      clientY: timeToClientY(10, 22),
    });
    await advanceSave();

    expect(planning.isConnected).toBe(true);
    expect(retro.isConnected).toBe(true);
  });
});
