import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/components/ui/sidebar.tsx", () => {
  return {
    SidebarTrigger: () => null,
  };
});

import AppCalendar from "../../src/components/calendar/Calendar.tsx";
import { DateTime } from "luxon";

beforeEach(() => {
  Element.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.scrollIntoView = () => {};
});

describe("Calendar", () => {
  const checkGrid = async () => {
    expect(await screen.findByText(/today/i)).toBeInTheDocument();

    for (const x of Array.from(
      { length: 24 },
      (_, i) => `${((i + 11) % 12) + 1} ${i < 12 ? "AM" : "PM"}`,
    )) {
      expect(await screen.findByText(x)).toBeInTheDocument();
    }

    expect(
      await screen.findByText(DateTime.now().toFormat("EEE d")),
    ).toBeInTheDocument();
  };

  const checkEventBlocks = async () => {
    expect(
      (await screen.findAllByText(/My Test Event/)).length,
    ).toBeGreaterThan(0);

    expect(
      (await screen.findAllByText(/My Even Cooler Test Event/)).length,
    ).toBeGreaterThan(0);
  };

  const createEditableEvent = async () => {
    const user = userEvent.setup();
    const saveEvents = vi.fn();

    render(
      <AppCalendar
        events={testEvents}
        mode="week"
        setMode={vi.fn()}
        saveEvents={saveEvents}
      />,
    );

    await checkGrid();

    const gridBox = document.querySelector('div[data-day-index="3"]')!;
    expect(gridBox).not.toBeNull();
    expect(gridBox).toBeInTheDocument();

    await user.click(gridBox);

    const eventBlock = await screen.findAllByText("new event");
    expect(eventBlock.length).toBeGreaterThan(0);
    expect(eventBlock[0]).toBeInTheDocument();

    expect(saveEvents).toBeCalled();

    await user.dblClick(eventBlock[0]);

    return { user, saveEvents, eventBlock };
  };

  const testEvents = [
    {
      id: "test-event",
      title: "My Test Event",
      start: DateTime.now().startOf("day"),
      end: DateTime.now().endOf("day"),
      timestamp: Date.now(),
    },
    {
      id: "test-event-2",
      title: "My Even Cooler Test Event",
      start: DateTime.now().startOf("week"),
      end: DateTime.now().startOf("week").plus({ hour: 1 }),
      timestamp: Date.now(),
      repeat: {
        interval: 1,
        unit: "day",
      },
    },
  ];

  it("renders without events in day view", async () => {
    render(
      <AppCalendar
        events={[]}
        mode="day"
        setMode={() => {}}
        saveEvents={() => {}}
      />,
    );
    await checkGrid();
  });

  it("renders with recurring event in day view", async () => {
    render(
      <AppCalendar
        events={testEvents}
        mode="day"
        setMode={() => {}}
        saveEvents={() => {}}
      />,
    );

    await checkGrid();
    await checkEventBlocks();
  });

  it("renders without events in week view", async () => {
    render(
      <AppCalendar
        events={[]}
        mode="week"
        setMode={() => {}}
        saveEvents={() => {}}
      />,
    );
    await checkGrid();
  });

  it("renders with recurring event in week view", async () => {
    render(
      <AppCalendar
        events={testEvents}
        mode="week"
        setMode={() => {}}
        saveEvents={() => {}}
      />,
    );

    await checkGrid();
    await checkEventBlocks();
  });

  it("switches between week and day view", async () => {
    const setMode = vi.fn();
    const user = userEvent.setup();

    render(
      <AppCalendar
        events={testEvents}
        mode="week"
        setMode={setMode}
        saveEvents={vi.fn()}
      />,
    );

    await checkGrid();

    const selectBtn = screen.getByRole("combobox");
    await user.click(selectBtn);

    const dayOption = await screen.findByRole("option", { name: /day/i });
    await user.click(dayOption);

    expect(setMode).toHaveBeenCalledWith("day");
  });

  it("switches between day and week view", async () => {
    const setMode = vi.fn();
    const user = userEvent.setup();

    render(
      <AppCalendar
        events={testEvents}
        mode="day"
        setMode={setMode}
        saveEvents={vi.fn()}
      />,
    );

    await checkGrid();

    const selectBtn = screen.getByRole("combobox");
    await user.click(selectBtn);

    const weekOption = await screen.findByRole("option", { name: /week/i });
    await user.click(weekOption);

    expect(setMode).toHaveBeenCalledWith("week");
  });

  it("zooms grid with ctrl + mouse wheel", async () => {
    render(
      <AppCalendar
        events={[]}
        mode="day"
        setMode={vi.fn()}
        saveEvents={vi.fn()}
      />,
    );

    const grid: HTMLDivElement = document.querySelector(".grid")!;
    const initial = grid.style.gridTemplateRows;

    window.dispatchEvent(
      new WheelEvent("wheel", {
        ctrlKey: true,
        deltaY: -100,
        bubbles: true,
      }),
    );

    await waitFor(() => {
      expect(grid.style.gridTemplateRows).not.toEqual(initial);
    });
  });

  it("edits event title", async () => {
    const { user, saveEvents } = await createEditableEvent();

    const titleInput = await screen.findByPlaceholderText("new event");
    expect(titleInput).toBeInTheDocument();

    await user.clear(titleInput);
    await user.type(titleInput, "renamed event");
    await user.keyboard("{Control>}s{/Control}");

    expect(saveEvents).toBeCalled();

    const renamedBlock = await screen.findAllByText("renamed event");
    expect(renamedBlock.length).toBeGreaterThan(0);
    expect(renamedBlock[0]).toBeInTheDocument();
  });

  it("deletes an event", async () => {
    const user = userEvent.setup();
    const saveEvents = vi.fn();

    render(
      <AppCalendar
        events={testEvents}
        mode="day"
        setMode={vi.fn()}
        saveEvents={saveEvents}
      />,
    );

    const eventBlock = await screen.findByText("My Test Event");

    await user.pointer({
      target: eventBlock,
      keys: "[MouseRight]",
    });

    const deleteBtn = await screen.findByText(/delete/i);
    await user.click(deleteBtn);

    expect(saveEvents).toBeCalled();
    expect(screen.queryByText("My Test Event")).not.toBeInTheDocument();
  });
});
