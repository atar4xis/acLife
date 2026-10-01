import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import * as a11y from "../../src/lib/calendar/a11y.ts";
import * as CalendarContext from "../../src/context/CalendarContext.tsx";
import { focusGrid } from "./gridKeyboardHelpers";
import {
  FIXED_NOW,
  buildEvent,
  buildPlainEvent,
  ctrlClickEvent,
  getDayCell,
  getEventBlock,
  isSelected,
  renderCalendar,
  setupCalendarTests,
} from "./helpers";

setupCalendarTests();

describe("selection renders", () => {
  it("re-renders only the event blocks whose selection changed", async () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      buildEvent({
        id: `event-${i}`,
        title: `Event ${i}`,
        start: FIXED_NOW.startOf("day").plus({ hours: 1 + i * 2 }),
        end: FIXED_NOW.startOf("day").plus({ hours: 2 + i * 2 }),
      }),
    );
    renderCalendar({ mode: "week", events });
    const block = await getEventBlock("Event 3");

    // every render of an event block describes its event once
    const describeEvent = vi.spyOn(a11y, "describeEvent");
    await ctrlClickEvent("Event 3");

    expect(isSelected(block)).toBe(true);
    expect(describeEvent).toHaveBeenCalledTimes(1);
  });
});

describe("selection renders", () => {
  it("leaves the calendar itself alone when the keyboard selects an event", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}");

    // every render of the calendar reads the date once
    const useCurrentDate = vi.spyOn(CalendarContext, "useCurrentDate");
    await user.keyboard("{ }");

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(useCurrentDate).not.toHaveBeenCalled();
  });
});

describe("navigation renders", () => {
  it("keeps the grid cells and headers mounted when the date changes", async () => {
    const { user } = renderCalendar({ mode: "week" });
    const cell = getDayCell(2);
    const header = screen.getAllByRole("columnheader")[0];

    await user.click(screen.getByTestId("next-btn"));

    expect(cell.isConnected).toBe(true);
    expect(header.isConnected).toBe(true);
  });
});

describe("event creation renders", () => {
  it("leaves the other event blocks alone when an event is created", async () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      buildEvent({
        id: `event-${i}`,
        title: `Event ${i}`,
        start: FIXED_NOW.startOf("day").plus({ hours: 1 + i * 2 }),
        end: FIXED_NOW.startOf("day").plus({ hours: 2 + i * 2 }),
      }),
    );
    renderCalendar({ mode: "week", events });
    await getEventBlock("Event 3");

    const describeEvent = vi.spyOn(a11y, "describeEvent");
    act(() => {
      fireEvent.pointerDown(getDayCell(1), {
        clientX: 100,
        clientY: 400,
        pointerId: 1,
        button: 0,
      });
    });

    // only the new event's block renders, not the six existing ones
    expect(describeEvent.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
