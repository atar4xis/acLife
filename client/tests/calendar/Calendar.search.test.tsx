import { describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import {
  FIXED_NOW,
  HOUR_HEIGHT,
  buildEvent,
  buildPlainEvent,
  renderCalendar,
  getEventBlock,
  isSelected,
  setupCalendarTests,
} from "./helpers";

setupCalendarTests();

const pickSearchResult = async (query: string) => {
  const input = await screen.findByPlaceholderText("Search events...");
  await act(async () => {
    fireEvent.change(input, { target: { value: query } });
  });
  await act(() => new Promise((r) => setTimeout(r, 700)));

  const result = (await screen.findAllByText(query))
    .map((el) => el.closest("li button"))
    .find(Boolean)!;
  await act(async () => {
    fireEvent.click(result);
  });
};

describe("Calendar search", () => {
  it("selects the event after picking a search result", async () => {
    renderCalendar({ mode: "week", events: [buildPlainEvent()] });

    await pickSearchResult("Planning");

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
  });

  it("scrolls the picked result into view", async () => {
    renderCalendar({ mode: "week", events: [buildPlainEvent()] });
    const grid = screen.getByRole("grid");
    grid.scrollTop = 0;
    Object.defineProperty(grid, "clientHeight", { value: 300 });

    await pickSearchResult("Planning");

    // 9am at 60px/hour, positioned a third of the way down the viewport
    expect(grid.scrollTop).toBe(9 * HOUR_HEIGHT - 100);
  });

  it("navigates to a result in another week, then selects and scrolls to it", async () => {
    renderCalendar({
      mode: "week",
      events: [
        buildEvent({
          start: FIXED_NOW.plus({ weeks: 2 }).startOf("day").plus({ hours: 9 }),
          end: FIXED_NOW.plus({ weeks: 2 }).startOf("day").plus({ hours: 10 }),
        }),
      ],
    });
    const grid = screen.getByRole("grid");
    grid.scrollTop = 0;
    Object.defineProperty(grid, "clientHeight", { value: 300 });

    await pickSearchResult("Planning");

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(grid.scrollTop).toBe(9 * HOUR_HEIGHT - 100);
  });
});
