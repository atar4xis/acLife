import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook } from "@testing-library/react";
import useAnchoredPosition from "../../src/hooks/useAnchoredPosition";
import { stubMobile } from "../mobile.ts";

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }) as DOMRect;

let panelEl!: HTMLElement;

const setup = ({
  anchor,
  grid = rect(100, 0, 800, 600),
  panel = rect(0, 0, 200, 100),
  beside = true,
}: {
  anchor: DOMRect;
  grid?: DOMRect;
  panel?: DOMRect;
  beside?: boolean;
}) => {
  const gridEl = document.createElement("div");
  gridEl.setAttribute("role", "grid");
  const anchorEl = document.createElement("div");
  gridEl.append(anchorEl);
  panelEl = document.createElement("div");
  vi.spyOn(gridEl, "getBoundingClientRect").mockReturnValue(grid);
  vi.spyOn(anchorEl, "getBoundingClientRect").mockReturnValue(anchor);
  vi.spyOn(panelEl, "getBoundingClientRect").mockReturnValue(panel);
  const panelRef = { current: panelEl };
  const anchorRef = { current: anchorEl };
  return renderHook(() => useAnchoredPosition(panelRef, anchorRef, beside));
};

const press = (init: Partial<PointerEventInit> & { target?: Element } = {}) => {
  const target = init.target ?? document.body;
  return { button: 0, target, clientX: 0, clientY: 0, ...init } as never;
};

const observers: (() => void)[] = [];

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAnchoredPosition", () => {
  it("puts the panel left of the anchor, top aligned", () => {
    const { result } = setup({ anchor: rect(500, 200, 100, 50) });

    expect(result.current.pos).toEqual({ left: 500 - 200, top: 200 });
  });

  it("falls back to the right when the left would leave the grid", () => {
    const { result } = setup({ anchor: rect(250, 200, 100, 50) });

    expect(result.current.pos).toEqual({ left: 350, top: 200 });
  });

  it("judges the left side by the grid, not the window", () => {
    const { result } = setup({
      anchor: rect(250, 200, 100, 50),
      grid: rect(0, 0, 800, 600),
    });

    expect(result.current.pos.left).toBe(250 - 200);
  });

  it("clamps into the window", () => {
    const { result } = setup({ anchor: rect(500, 700, 100, 50) });

    expect(result.current.pos.top).toBe(768 - 100);
  });

  it("centres over the anchor when not beside", () => {
    const { result } = setup({
      anchor: rect(500, 200, 100, 50),
      beside: false,
    });

    expect(result.current.pos).toEqual({ left: 450, top: 200 - 15 });
  });

  it("goes full width at the top on mobile", () => {
    stubMobile();
    vi.stubGlobal("innerWidth", 400);
    const { result } = setup({ anchor: rect(250, 200, 100, 50) });

    expect(result.current.isMobile).toBe(true);
    expect(result.current.pos).toEqual({ left: 100, top: 0 });
  });

  it("follows the pointer while dragging, clamped to the window", () => {
    const { result } = setup({ anchor: rect(500, 200, 100, 50) });
    const start = result.current.pos;

    act(() =>
      result.current.startDrag(
        press({ clientX: start.left + 5, clientY: start.top + 5 }),
      ),
    );
    act(() => {
      fireEvent.pointerMove(window, { clientX: start.left + 55, clientY: start.top + 45 });
    });
    expect(result.current.pos).toEqual({ left: start.left + 50, top: start.top + 40 });

    act(() => {
      fireEvent.pointerMove(window, { clientX: -500, clientY: 5000 });
    });
    expect(result.current.pos).toEqual({ left: 0, top: 768 - 100 });
  });

  it("stops following after the pointer is released", () => {
    const { result } = setup({ anchor: rect(500, 200, 100, 50) });
    const start = result.current.pos;

    act(() => result.current.startDrag(press({ clientX: start.left, clientY: start.top })));
    act(() => {
      fireEvent.pointerUp(window);
      fireEvent.pointerMove(window, { clientX: 0, clientY: 0 });
    });

    expect(result.current.pos).toEqual(start);
  });

  it("does not drag from a button, with another mouse button, or on mobile", () => {
    const { result } = setup({ anchor: rect(500, 200, 100, 50) });
    const start = result.current.pos;
    const button = document.createElement("button");

    act(() => result.current.startDrag(press({ target: button })));
    act(() => result.current.startDrag(press({ button: 2 })));
    act(() => {
      fireEvent.pointerMove(window, { clientX: 5, clientY: 5 });
    });

    expect(result.current.pos).toEqual(start);

    stubMobile();
    const mobile = setup({ anchor: rect(500, 200, 100, 50) });
    const mobileStart = mobile.result.current.pos;
    act(() => mobile.result.current.startDrag(press()));
    act(() => {
      fireEvent.pointerMove(window, { clientX: 5, clientY: 5 });
    });

    expect(mobile.result.current.pos).toEqual(mobileStart);
  });

  it("clamps a panel that overflows the window on the right", () => {
    const { result } = setup({ anchor: rect(120, 200, 830, 50) });

    expect(result.current.pos.left).toBe(1024 - 200);
  });

  it("keeps a dragged position when the panel resizes, clamped to the window", () => {
    const { result } = setup({ anchor: rect(500, 200, 100, 50) });
    const start = result.current.pos;

    act(() => result.current.startDrag(press({ clientX: start.left, clientY: start.top })));
    act(() => {
      fireEvent.pointerMove(window, { clientX: 300, clientY: 100 });
      fireEvent.pointerUp(window);
    });
    expect(result.current.pos).toEqual({ left: 300, top: 100 });

    act(() => observers.forEach((notify) => notify()));
    expect(result.current.pos).toEqual({ left: 300, top: 100 });

    vi.spyOn(panelEl, "getBoundingClientRect").mockReturnValue(rect(0, 0, 900, 700));
    act(() => observers.forEach((notify) => notify()));
    expect(result.current.pos).toEqual({ left: 1024 - 900, top: 768 - 700 });
  });

  it("re-anchors a panel that was not dragged when it resizes", () => {
    const { result } = setup({ anchor: rect(500, 200, 100, 50) });

    vi.spyOn(panelEl, "getBoundingClientRect").mockReturnValue(rect(0, 0, 300, 100));
    act(() => observers.forEach((notify) => notify()));

    expect(result.current.pos.left).toBe(500 - 300);
  });
});
