import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/components/ui/sidebar.tsx", () => {
  return {
    SidebarTrigger: () => null,
  };
});

import AppCalendar from "../../src/components/calendar/Calendar.tsx";
import { DateTime } from "luxon";

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

    Element.prototype.hasPointerCapture = () => false;
    window.HTMLElement.prototype.scrollIntoView = () => {};

    await checkGrid();

    const selectBtn = screen.getByRole("combobox");
    await user.click(selectBtn);

    const dayOption = await screen.findByRole("option", { name: /day/i });
    await user.click(dayOption);

    expect(setMode).toHaveBeenCalledWith("day");
  });
});
