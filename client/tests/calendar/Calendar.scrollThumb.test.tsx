import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import * as CalendarContext from "../../src/context/CalendarContext.tsx";
import { renderCalendar, setupCalendarTests } from "./helpers";

setupCalendarTests();

// jsdom has no layout, so give the grid a scroll size and a writable scrollTop
const overflow = (
  grid: HTMLElement,
  scrollHeight = 2000,
  clientHeight = 500,
) => {
  let scrollTop = 0;
  Object.defineProperties(grid, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    },
  });
};

const scroll = (grid: HTMLElement) => fireEvent.scroll(grid);

beforeEach(() => {
  Element.prototype.setPointerCapture = () => {};
});

describe("scroll thumb", () => {
  it("appears once the grid overflows, sized to the visible share", () => {
    renderCalendar({ mode: "week" });
    const grid = screen.getByRole("grid");
    expect(screen.queryByTestId("scroll-thumb")).toBeNull();

    overflow(grid);
    scroll(grid);

    const thumb = screen.getByTestId("scroll-thumb");
    expect(thumb.style.height).toBe("125px");
    expect(thumb.style.top).toBe("0px");
  });

  it("follows the scroll position", () => {
    renderCalendar({ mode: "week" });
    const grid = screen.getByRole("grid");
    overflow(grid);

    grid.scrollTop = 1500;
    scroll(grid);

    // the track is the 375px not covered by the thumb
    expect(screen.getByTestId("scroll-thumb").style.top).toBe("375px");
  });

  it("hides after a moment and returns on pointer movement", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    renderCalendar({ mode: "week" });
    const grid = screen.getByRole("grid");
    overflow(grid);
    scroll(grid);
    expect(screen.getByTestId("scroll-thumb")).toHaveClass("opacity-100");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId("scroll-thumb")).toHaveClass("opacity-0");

    fireEvent.pointerMove(grid);
    expect(screen.getByTestId("scroll-thumb")).toHaveClass("opacity-100");
  });

  it("scrolls the grid when dragged", () => {
    renderCalendar({ mode: "week" });
    const grid = screen.getByRole("grid");
    overflow(grid);
    scroll(grid);

    fireEvent.pointerDown(screen.getByTestId("scroll-thumb"), {
      pointerId: 1,
      clientY: 0,
    });
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 1, clientY: 75 }),
      );
    });

    // 75px of a 375px track is a fifth of the 1500px that can scroll
    expect(grid.scrollTop).toBe(300);
  });

  it("does not re-render the calendar while scrolling", () => {
    renderCalendar({ mode: "week" });
    const grid = screen.getByRole("grid");
    overflow(grid);

    // every render of the calendar reads the date once
    const useCurrentDate = vi.spyOn(CalendarContext, "useCurrentDate");
    for (const top of [100, 400, 900, 1500]) {
      grid.scrollTop = top;
      scroll(grid);
    }
    fireEvent.pointerMove(grid);

    expect(screen.getByTestId("scroll-thumb")).toBeTruthy();
    expect(useCurrentDate).not.toHaveBeenCalled();
  });
});
