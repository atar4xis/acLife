import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { touchDrag } from "../../src/lib/touchDrag.ts";

class FakeDragEvent extends Event {
  clientX: number;
  clientY: number;
  constructor(type: string, init: EventInit & { clientX: number; clientY: number }) {
    super(type, init);
    this.clientX = init.clientX;
    this.clientY = init.clientY;
  }
}

const setup = (droppable = true) => {
  const calls = { start: vi.fn(), end: vi.fn(), over: vi.fn(), click: vi.fn() };
  const events: string[] = [];
  render(
    <div>
      <button
        onClick={calls.click}
        onPointerDown={touchDrag({
          label: "Dragged",
          onStart: calls.start,
          onEnd: calls.end,
          onOver: calls.over,
        })}
      >
        source
      </button>
      <div
        data-testid="target"
        onDragOver={(e) => {
          events.push("over");
          if (droppable) e.preventDefault();
        }}
        onDragLeave={() => events.push("leave")}
        onDrop={() => events.push("drop")}
      />
      <div data-testid="other" data-slot="sheet-overlay" />
    </div>,
  );
  return { ...calls, events };
};

const hold = () => act(() => vi.advanceTimersByTime(400));
const touchDown = () =>
  fireEvent.pointerDown(screen.getByText("source"), {
    pointerType: "touch",
    clientX: 5,
    clientY: 5,
  });
const touchMove = (x: number, y: number) =>
  fireEvent.pointerMove(window, { pointerType: "touch", clientX: x, clientY: y });

describe("touchDrag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("DragEvent", FakeDragEvent);
    vi.stubGlobal("DataTransfer", class {});
    document.elementFromPoint = vi.fn(() => screen.getByTestId("target"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts after a long press, follows the finger and drops on release", () => {
    const { start, end, events, click } = setup();

    touchDown();
    expect(start).not.toHaveBeenCalled();
    hold();
    expect(start).toHaveBeenCalledOnce();
    expect(screen.getByText("Dragged")).toBeTruthy();

    touchMove(50, 60);
    expect(events).toEqual(["over"]);
    expect(screen.getByText("Dragged").style.transform).toBe(
      "translate(62px, 72px)",
    );

    fireEvent.pointerUp(window, { pointerType: "touch" });
    expect(events).toEqual(["over", "drop"]);
    expect(end).toHaveBeenCalledOnce();
    expect(screen.queryByText("Dragged")).toBeNull();

    fireEvent.click(screen.getByText("source"));
    expect(click).not.toHaveBeenCalled();
  });

  it("blocks page scrolling only while dragging", () => {
    setup();
    touchDown();
    expect(fireEvent.touchMove(window)).toBe(true);
    hold();
    expect(fireEvent.touchMove(window)).toBe(false);
    fireEvent.pointerUp(window, { pointerType: "touch" });
    expect(fireEvent.touchMove(window)).toBe(true);
  });

  it("does not drop where the target refused the drag", () => {
    const { events, end } = setup(false);
    touchDown();
    hold();
    touchMove(50, 60);
    fireEvent.pointerUp(window, { pointerType: "touch" });
    expect(events).toEqual(["over"]);
    expect(end).toHaveBeenCalledOnce();
  });

  it("leaves the previous target when the finger moves on", () => {
    const { events } = setup();
    touchDown();
    hold();
    touchMove(10, 10);
    document.elementFromPoint = vi.fn(() => screen.getByTestId("other"));
    touchMove(20, 20);
    expect(events).toEqual(["over", "leave"]);
  });

  it("reports the element under the finger while dragging", () => {
    const { over } = setup();
    document.elementFromPoint = vi.fn(() => screen.getByTestId("other"));
    touchDown();
    hold();
    touchMove(10, 10);
    expect(over).toHaveBeenCalledOnce();
    expect(over).toHaveBeenCalledWith(screen.getByTestId("other"));
  });

  it("cancels when the finger moves before the hold, so scrolling still works", () => {
    const { start, end } = setup();
    touchDown();
    touchMove(5, 40);
    hold();
    expect(start).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { pointerType: "touch" });
    expect(end).not.toHaveBeenCalled();
  });

  it("ends the drag when the browser cancels the pointer", () => {
    const { end, events } = setup();
    touchDown();
    hold();
    fireEvent.pointerCancel(window, { pointerType: "touch" });
    expect(end).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
  });

  it("ignores mouse input", () => {
    const { start } = setup();
    fireEvent.pointerDown(screen.getByText("source"), { pointerType: "mouse" });
    hold();
    expect(start).not.toHaveBeenCalled();
  });
});
