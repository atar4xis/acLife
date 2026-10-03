import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { applyLanguage } from "../../src/i18n";
import DragOverlay from "../../src/components/calendar/DragOverlay.tsx";
import { buildPlainEvent, renderCalendar, setupCalendarTests } from "./helpers";

setupCalendarTests();

const headers = () =>
  screen.getAllByRole("columnheader").map((header) => header.textContent);

const afterNext = async () => {
  const { user, unmount } = renderCalendar({ mode: "week" });
  await user.click(screen.getByTestId("next-btn"));
  const result = headers();
  unmount();
  return result;
};

afterEach(() => applyLanguage("en"));

describe("right-to-left navigation", () => {
  it("ArrowLeft goes forward and ArrowRight goes back", async () => {
    applyLanguage("ar");
    const forward = await afterNext();
    const { unmount } = renderCalendar({ mode: "week" });
    const start = headers();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(headers()).toEqual(forward);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(headers()).toEqual(start);
    unmount();
  });

  it("ArrowLeft still goes back in left-to-right languages", () => {
    renderCalendar({ mode: "week", events: [buildPlainEvent()] });
    const start = headers();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(headers()).not.toEqual(start);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(headers()).toEqual(start);
  });
});

describe("drag edge arrows", () => {
  const dragRef = { current: { label: "label", event: buildPlainEvent() } };

  const hoverEdge = (side: "left" | "right") => {
    const arrows = Array.from(document.querySelectorAll("[data-steps]"));
    const arrow = arrows.find((el) => el.className.includes(`${side}-0`))!;
    fireEvent.pointerEnter(arrow);
    act(() => {
      vi.advanceTimersByTime(700);
    });
  };

  const setup = (language: string) => {
    applyLanguage(language);
    vi.useFakeTimers();
    const move = vi.fn();
    render(
      <DragOverlay
        move={move}
        dragRef={dragRef as never}
      />,
    );
    return move;
  };

  afterEach(() => vi.useRealTimers());

  it.each([
    ["en", "left", -1],
    ["en", "right", 1],
    ["ar", "left", 1],
    ["ar", "right", -1],
  ] as const)("in %s the %s arrow moves by %i", (language, side, steps) => {
    const move = setup(language);
    hoverEdge(side);
    expect(move).toHaveBeenCalledWith(steps);
  });

  it("moves by the screen side when a touch drag reaches an edge", () => {
    const move = setup("ar");
    fireEvent.pointerMove(document, { pointerType: "touch", clientX: 4 });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(move).toHaveBeenCalledWith(1);
  });
});
