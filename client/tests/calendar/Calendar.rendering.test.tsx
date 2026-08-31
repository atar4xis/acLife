import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import {
  TODAY_LABEL,
  WEEK_LABELS,
  HOUR_LABELS,
  buildEvent,
  buildPlainEvent,
  buildRecurringEvent,
  renderCalendar,
  getEventBlock,
  setupCalendarTests,
  FIXED_NOW,
} from "./helpers";

setupCalendarTests();

describe("Calendar", () => {
  it("renders day view scaffold", async () => {
    renderCalendar();

    expect(await screen.findByText(/today/i)).toBeInTheDocument();
    expect(screen.getByText(TODAY_LABEL)).toBeInTheDocument();

    for (const label of HOUR_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders week view with expanded recurring events", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildRecurringEvent()],
    });

    for (const label of WEEK_LABELS) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }

    expect(await screen.findByText("Planning")).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Daily standup")).length,
    ).toBeGreaterThan(1);
  });

  it("moves between days and returns to today", async () => {
    const { user } = renderCalendar();

    expect(await screen.findByText("Wed 18")).toBeInTheDocument();

    await user.click(screen.getByTestId("next-btn"));
    await waitFor(() => {
      expect(screen.getByText("Thu 19")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /today/i }));
    await waitFor(() => {
      expect(screen.getByText("Wed 18")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("prev-btn"));
    await waitFor(() => {
      expect(screen.getByText("Tue 17")).toBeInTheDocument();
    });
  });

  it("switches view mode from selector", async () => {
    const setMode = vi.fn();
    const { user } = renderCalendar({ mode: "week", setMode });

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /day/i }));

    expect(setMode).toHaveBeenCalledWith("day");
  });

  it("zooms grid with ctrl + mouse wheel", async () => {
    renderCalendar();

    const grid = document.querySelector(".grid") as HTMLDivElement | null;
    expect(grid).toBeTruthy();

    const initialRows = grid!.style.gridTemplateRows;

    act(() => {
      window.dispatchEvent(
        new WheelEvent("wheel", {
          ctrlKey: true,
          deltaY: -100,
          bubbles: true,
        }),
      );
    });

    await waitFor(() => {
      expect(grid!.style.gridTemplateRows).not.toEqual(initialRows);
    });
  });

  it("shows same event date and time in day and week views", async () => {
    const timedEvent = buildEvent({
      title: "Review",
      start: FIXED_NOW.startOf("day").plus({ hours: 14, minutes: 30 }),
      end: FIXED_NOW.startOf("day").plus({ hours: 16 }),
    });

    const dayRender = renderCalendar({
      mode: "day",
      events: [timedEvent],
    });

    const dayBlock = await getEventBlock("Review");
    expect(screen.getByText("Wed 18")).toBeInTheDocument();
    expect(dayBlock).toHaveTextContent("2:30 - 4 PM");

    dayRender.unmount();

    renderCalendar({
      mode: "week",
      events: [timedEvent],
    });

    const weekBlock = await getEventBlock("Review");
    expect(screen.getByText("Wed 18")).toBeInTheDocument();
    expect(weekBlock).toHaveTextContent("2:30 - 4 PM");
  });
});
