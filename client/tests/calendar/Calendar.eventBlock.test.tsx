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

  it("collapses a popped-out event once the drag exceeds the movement threshold", async () => {
    renderCalendar({ events: [buildTinyEvent()] });

    const block = await getEventBlock("Standup");

    fireEvent.mouseEnter(block);
    await wait(200);
    expect(block.style.height).toBe("32px");

    fireEvent.pointerDown(block, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
    });

    // still under the movement threshold: stays popped out
    dispatchWindowPointer("pointermove", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 2,
      clientY: 0,
    });
    expect(block.style.height).toBe("32px");

    // moved past the threshold: this is now a real drag, collapse
    dispatchWindowPointer("pointermove", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 20,
      clientY: 0,
    });
    expect(block.style.height).toBe("10px");

    dispatchWindowPointer("pointerup", {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 20,
      clientY: 0,
    });
  });

  it("stays popped out through a double click instead of snapping shut on mousedown", async () => {
    renderCalendar({ events: [buildTinyEvent()] });

    const block = await getEventBlock("Standup");

    fireEvent.mouseEnter(block);
    await wait(200);
    expect(block.style.height).toBe("32px");

    for (let i = 0; i < 2; i++) {
      fireEvent.pointerDown(block, {
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
        clientX: 0,
        clientY: 0,
      });
      dispatchWindowPointer("pointerup", {
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
        clientX: 0,
        clientY: 0,
      });
    }
    fireEvent.doubleClick(block);

    expect(block.style.height).toBe("32px");
  });

  it("does not pop out when hovered while another event is being dragged", async () => {
    renderCalendar({ events: [buildTinyEvent()] });

    const block = await getEventBlock("Standup");

    fireEvent.mouseEnter(block, { buttons: 1 });

    await wait(200);
    expect(block.style.height).toBe("10px");
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
