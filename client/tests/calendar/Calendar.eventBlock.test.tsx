import { describe, expect, it } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import {
  buildEvent,
  renderCalendar,
  getEventBlock,
  setupCalendarTests,
  dispatchWindowPointer,
  FIXED_NOW,
} from "./helpers";

setupCalendarTests();

const buildTinyEvent = () =>
  buildEvent({
    title: "Standup",
    start: FIXED_NOW.startOf("day").plus({ hours: 9 }),
    end: FIXED_NOW.startOf("day").plus({ hours: 9, minutes: 10 }),
  });

const wait = (ms: number) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));

describe("EventBlock pop out", () => {
  it("pops out a tiny event after hovering for a bit", async () => {
    renderCalendar({ events: [buildTinyEvent()] });

    const block = await getEventBlock("Standup");
    expect(block.style.height).toBe("10px");

    fireEvent.mouseEnter(block);

    // not enough time has passed yet
    await wait(50);
    expect(block.style.height).toBe("10px");

    await wait(150);
    expect(block.style.height).toBe("32px");
  });

  it("cancels the pop out if the pointer leaves before the delay elapses", async () => {
    renderCalendar({ events: [buildTinyEvent()] });

    const block = await getEventBlock("Standup");

    fireEvent.mouseEnter(block);
    fireEvent.mouseLeave(block);

    await wait(200);
    expect(block.style.height).toBe("10px");
  });

  it("does not pop out while the event is being dragged", async () => {
    renderCalendar({ events: [buildTinyEvent()] });

    const block = await getEventBlock("Standup");

    fireEvent.mouseEnter(block);
    fireEvent.pointerDown(block, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
    });

    await wait(200);
    expect(block.style.height).toBe("10px");

    dispatchWindowPointer("pointerup", {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
    });
  });

  it("does not pop out when hovered while a drag is already in progress", async () => {
    renderCalendar({ events: [buildTinyEvent()] });

    const block = await getEventBlock("Standup");

    // drag starts elsewhere, then the pointer is dragged over this block
    fireEvent.pointerDown(block, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
    });
    fireEvent.mouseEnter(block);

    await wait(200);
    expect(block.style.height).toBe("10px");

    dispatchWindowPointer("pointerup", {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
    });
  });

  it("does not affect the displayed times", async () => {
    renderCalendar({ events: [buildTinyEvent()] });

    const block = await getEventBlock("Standup");
    fireEvent.mouseEnter(block);

    await wait(200);
    expect(block.style.height).toBe("32px");
    expect(block).toHaveTextContent("9 - 9:10 AM");
  });
});
