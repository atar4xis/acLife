import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import {
  advanceSave,
  buildPlainEvent,
  buildRecurringEvent,
  dayCenterX,
  dispatchWindowPointer,
  getDayCell,
  getEventBlock,
  getLastSavedEvents,
  renderCalendar,
  setupCalendarTests,
  timeToClientY,
} from "./helpers";

setupCalendarTests();

const touch = {
  button: 0,
  pointerId: 7,
  pointerType: "touch",
  clientX: dayCenterX(2),
  clientY: timeToClientY(9),
};

const finger = (clientX: number, clientY: number, identifier = 0) => ({
  clientX,
  clientY,
  identifier,
});

const fireTouch = (
  type: "touchstart" | "touchmove" | "touchend",
  target: Element,
  ...list: ReturnType<typeof finger>[]
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: Object.assign(list, { item: (i: number) => list[i] }),
  });
  Object.defineProperty(event, "changedTouches", { value: [list.at(-1)] });
  act(() => {
    target.dispatchEvent(event);
  });
};

const wait = (ms: number) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));

const longPress = async (title: string) => {
  fireEvent.pointerDown(await getEventBlock(title), touch);
  await wait(500);
};

const moveFinger = (clientY: number) =>
  dispatchWindowPointer("pointermove", { ...touch, clientY });

const releaseFinger = (clientY: number) =>
  dispatchWindowPointer("pointerup", { ...touch, clientY });

const secondFinger = (target: Element) =>
  fireTouch("touchstart", target, finger(dayCenterX(2), timeToClientY(9)),
      finger(dayCenterX(4), timeToClientY(9)));

const grid = () => document.querySelector('[role="grid"]') as HTMLElement;

const pinchOut = async () => {
  const cell = getDayCell(2);
  fireTouch("touchstart", cell, finger(100, 400), finger(200, 400));
  fireTouch("touchmove", cell, finger(100, 400), finger(200, 400));
  fireTouch("touchmove", cell, finger(50, 400), finger(250, 400));
  await wait(50);
  fireEvent.touchEnd(cell);
};

describe("touch drag: hold to move", () => {
  it("moves an event after a long press", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await longPress("Planning");
    moveFinger(timeToClientY(11));
    releaseFinger(timeToClientY(11));
    await advanceSave();

    expect(saveEvents).toHaveBeenCalled();
  });

  it("does not drag on a quick touch", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    fireEvent.pointerDown(await getEventBlock("Planning"), touch);
    await wait(100);
    moveFinger(timeToClientY(11));
    releaseFinger(timeToClientY(11));
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("does not drag when the finger moves before the hold completes", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    const block = await getEventBlock("Planning");
    fireEvent.pointerDown(block, touch);
    fireEvent.pointerMove(block, { ...touch, clientY: timeToClientY(9, 30) });
    await wait(500);
    moveFinger(timeToClientY(11));
    releaseFinger(timeToClientY(11));
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("removes the held look when the finger lifts off the block", async () => {
    renderCalendar({ mode: "week", events: [buildPlainEvent()] });

    await longPress("Planning");
    const block = await getEventBlock("Planning");
    expect(block.className).toContain("ring-2");
    releaseFinger(timeToClientY(9));

    expect(block.className).not.toContain("ring-2");
  });
});

describe("touch drag: pinch", () => {
  it("does not start a drag when a second finger lands during the hold", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    const block = await getEventBlock("Planning");
    fireEvent.pointerDown(block, touch);
    secondFinger(block);
    await wait(500);
    moveFinger(timeToClientY(11));
    releaseFinger(timeToClientY(11));
    await advanceSave();

    expect(block.className).not.toContain("ring-2");
    expect(saveEvents).not.toHaveBeenCalled();
  });

  const first = finger(dayCenterX(2), timeToClientY(9));
  const swipe = (block: Element, id: number, from: number, to: number) => {
    const x = dayCenterX(4);
    fireTouch("touchstart", block, first, finger(x, timeToClientY(from), id));
    fireTouch("touchmove", block, first, finger(x, timeToClientY(to), id));
  };

  it.each([
    ["above", 7, 6, 8, 10],
    ["below", 11, 12, 9, 11],
  ])(
    "resizes when a second finger swipes %s the dragging finger",
    async (_, from, to, startHour, endHour) => {
      const saveEvents = vi.fn();
      renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

      await longPress("Planning");
      moveFinger(timeToClientY(9));
      swipe(await getEventBlock("Planning"), 1, from, to);
      releaseFinger(timeToClientY(9));
      await advanceSave();

      const [saved] = getLastSavedEvents(saveEvents);
      expect(saved.start.hour).toBe(startHour);
      expect(saved.end.hour).toBe(endHour);
    },
  );

  it("keeps resizing with a new finger after the second finger lifts", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await longPress("Planning");
    moveFinger(timeToClientY(9));
    const block = await getEventBlock("Planning");
    swipe(block, 1, 7, 6);
    fireTouch("touchend", block, finger(dayCenterX(4), timeToClientY(6), 1));
    swipe(block, 2, 7, 6);
    releaseFinger(timeToClientY(9));
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].start.hour).toBe(7);
  });

  it("zooms the grid with two fingers", async () => {
    renderCalendar({ mode: "week", events: [buildPlainEvent()] });
    const before = grid().style.gridTemplateRows;

    await pinchOut();

    expect(grid().style.gridTemplateRows).not.toBe(before);
  });

  it("still swipes between weeks after a recurring event was held without moving", async () => {
    renderCalendar({ mode: "week", events: [buildRecurringEvent()] });

    await longPress("Daily standup");
    releaseFinger(timeToClientY(8));
    const before = grid().textContent;
    const cell = getDayCell(2);
    fireTouch("touchstart", cell, finger(300, 400));
    fireTouch("touchmove", cell, finger(100, 400));
    fireEvent.touchEnd(cell);

    expect(grid().textContent).not.toBe(before);
    expect(screen.queryByText(/update recurring event/i)).toBeNull();
  });
});

describe("touch drag: recurring events", () => {
  const dropRecurring = async () => {
    await longPress("Daily standup");
    moveFinger(timeToClientY(10));
    releaseFinger(timeToClientY(10));
    return screen.findByText(/update recurring event/i);
  };

  it("opens the dialog on release and clears the drag when cancelled", async () => {
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
    expect(block.className).not.toContain("ring-2");
    const before = grid().style.gridTemplateRows;
    await pinchOut();
    expect(grid().style.gridTemplateRows).not.toBe(before);
  });

  it("saves the move after confirming the dialog", async () => {
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

    expect(saveEvents).toHaveBeenCalled();
    expect(screen.queryByText(/update recurring event/i)).toBeNull();
  });

  it("keeps the pending move when a second finger lands while the dialog is open", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await longPress("Daily standup");
    dispatchWindowPointer("pointermove", {
      ...touch,
      clientX: dayCenterX(3),
      clientY: timeToClientY(10),
    });
    releaseFinger(timeToClientY(10));
    await screen.findByText(/update recurring event/i);
    secondFinger(grid());
    await user.click(screen.getByRole("radio", { name: /this event/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    const overrides = Object.values(
      getLastSavedEvents(saveEvents)[0].repeat?.overrides ?? {},
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0].startShift).toBe(25 * 60 * 60 * 1000);
  });
});
