import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTime, Settings } from "luxon";
import {
  getMovedEvent,
  findFreeSlotForEvent,
} from "../../src/lib/calendar/moveHelpers";

vi.mock("../../src/components/ui/sidebar.tsx", () => {
  return {
    SidebarTrigger: () => null,
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    promise: vi.fn(),
  },
}));

import AppCalendar from "../../src/components/calendar/Calendar.tsx";
import { CalendarProvider } from "../../src/context/CalendarContext.tsx";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";

const FIXED_NOW = DateTime.fromISO("2026-03-18T10:30:00");
const TODAY_LABEL = FIXED_NOW.toFormat("EEE d");

const WEEK_LABELS = Array.from({ length: 7 }, (_, i) =>
  FIXED_NOW.startOf("week").plus({ days: i }).toFormat("EEE d"),
);
const GRID_HEADER_HEIGHT = 48;
const HOUR_HEIGHT = 60;
const TIME_GUTTER_WIDTH = 64;
const DAY_WIDTH = 100;
const HOUR_LABELS = Array.from(
  { length: 24 },
  (_, i) => `${((i + 11) % 12) + 1} ${i < 12 ? "AM" : "PM"}`,
);

const buildEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "plain-event",
  title: "Planning",
  description: "Sprint planning",
  start: FIXED_NOW.startOf("day").plus({ hours: 9 }),
  end: FIXED_NOW.startOf("day").plus({ hours: 10 }),
  timestamp: FIXED_NOW.toMillis(),
  ...overrides,
});

const buildPlainEvent = (): CalendarEvent => buildEvent();

const buildSecondEvent = (): CalendarEvent =>
  buildEvent({
    id: "second-event",
    title: "Retro",
    description: undefined,
    start: FIXED_NOW.startOf("day").plus({ hours: 13 }),
    end: FIXED_NOW.startOf("day").plus({ hours: 14 }),
  });

const buildSecondRecurringEvent = (): CalendarEvent =>
  buildEvent({
    id: "repeat-parent-2",
    title: "Weekly sync",
    description: undefined,
    start: FIXED_NOW.startOf("week").plus({ days: 2, hours: 14 }),
    end: FIXED_NOW.startOf("week").plus({ days: 2, hours: 15 }),
    repeat: {
      interval: 1,
      unit: "day" as const,
    },
  });

const buildRecurringEvent = (
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent =>
  buildEvent({
    id: "repeat-parent",
    title: "Daily standup",
    description: undefined,
    start: FIXED_NOW.startOf("week").plus({ days: 2, hours: 8 }),
    end: FIXED_NOW.startOf("week").plus({ days: 2, hours: 9 }),
    repeat: {
      interval: 1,
      unit: "day" as const,
    },
    ...overrides,
  });

const renderCalendar = ({
  events = [],
  mode = "day",
  saveEvents = vi.fn(),
  setMode = vi.fn(),
}: {
  events?: CalendarEvent[];
  mode?: "day" | "week";
  saveEvents?: ReturnType<typeof vi.fn>;
  setMode?: ReturnType<typeof vi.fn>;
} = {}) => {
  const user = userEvent.setup();

  const renderResult = render(
    <CalendarProvider>
      <AppCalendar
        events={events}
        mode={mode}
        setMode={setMode}
        saveEvents={saveEvents}
        syncEvents={vi.fn()}
      />
    </CalendarProvider>,
  );

  return { user, saveEvents, setMode, ...renderResult };
};

const advanceSave = async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
};

const getLastSavedEvents = (saveEvents: ReturnType<typeof vi.fn>) => {
  expect(saveEvents).toHaveBeenCalled();
  return saveEvents.mock.lastCall?.[0] as CalendarEvent[];
};

const getDayCell = (dayIndex = 0) => {
  const cell = document.querySelector(
    `.grid-cell[data-day-index="${dayIndex}"]`,
  ) as HTMLDivElement | null;

  expect(cell).toBeTruthy();
  return cell!;
};

const getEventBlock = async (title: string) => {
  const labels = await screen.findAllByText(title);
  const label =
    labels.find((node) => node.closest(".event-block")) ?? labels[0];
  const block = label.closest(".event-block") as HTMLDivElement | null;

  expect(block).toBeTruthy();
  return block!;
};

const openEventEditor = async (
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) => {
  await user.dblClick(await getEventBlock(title));
  expect(
    await screen.findByRole("heading", { name: /edit event/i }),
  ).toBeInTheDocument();
};

const openEventMenu = async (
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) => {
  await user.pointer({
    target: await getEventBlock(title),
    keys: "[MouseRight]",
  });
};

const pickCalendarDate = async (
  user: ReturnType<typeof userEvent.setup>,
  trigger: HTMLElement,
  target: DateTime,
) => {
  await user.click(trigger);

  const dayButton = await waitFor(() => {
    const el = document.querySelector(
      `[data-day="${target.toISODate()}"] button`,
    ) as HTMLElement | null;
    expect(el).toBeTruthy();
    return el!;
  });

  await user.click(dayButton);
};

const ctrlClick = (block: Element, clientX = 0, clientY = 0) => {
  act(() => {
    fireEvent.pointerDown(block, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      ctrlKey: true,
      clientX,
      clientY,
    });
  });

  dispatchWindowPointer("pointerup", {
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    ctrlKey: true,
    clientX,
    clientY,
  });
};

const ctrlClickEvent = async (title: string) => {
  ctrlClick(await getEventBlock(title));
};

const ctrlClickKey = async (key: string) => {
  const block = document.querySelector(
    `[data-event-key="${key}"]`,
  ) as HTMLElement | null;

  expect(block).toBeTruthy();
  ctrlClick(block!);
};

const isSelected = (block: Element) =>
  (block as HTMLElement).style.boxShadow.includes("inset");

const getSelectionBox = () =>
  document.querySelector(".selection-box") as HTMLElement | null;

const startSelectionBox = ({
  x,
  y,
  from,
}: {
  x: number;
  y: number;
  from?: Element;
}) => {
  act(() => {
    fireEvent.pointerDown(from ?? getDayCell(0), {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      ctrlKey: true,
      clientX: x,
      clientY: y,
    });
  });
};

const moveSelectionBox = ({ x, y }: { x: number; y: number }) =>
  dispatchWindowPointer("pointermove", {
    pointerId: 1,
    pointerType: "mouse",
    ctrlKey: true,
    clientX: x,
    clientY: y,
  });

const endSelectionBox = ({ x, y }: { x: number; y: number }) =>
  dispatchWindowPointer("pointerup", {
    pointerId: 1,
    pointerType: "mouse",
    ctrlKey: true,
    clientX: x,
    clientY: y,
  });

const dragSelectionBox = async ({
  startX,
  startY,
  endX,
  endY,
  from,
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  from?: Element;
}) => {
  startSelectionBox({ x: startX, y: startY, from });
  moveSelectionBox({ x: endX, y: endY });
  endSelectionBox({ x: endX, y: endY });
};

const countEventBlocks = (title: string) =>
  Array.from(document.querySelectorAll(".event-block")).filter((node) =>
    node.textContent?.includes(title),
  ).length;

const makeRect = (left: number, top: number, width: number, height: number) =>
  ({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => {},
  }) as DOMRect;

const dayCenterX = (dayIndex: number) =>
  TIME_GUTTER_WIDTH + DAY_WIDTH * dayIndex + DAY_WIDTH / 2;

const timeToClientY = (hour: number, minute = 0) =>
  GRID_HEADER_HEIGHT + hour * HOUR_HEIGHT + minute;

const dispatchWindowPointer = (
  type: "pointermove" | "pointerup",
  init: PointerEventInit,
) => {
  act(() => {
    window.dispatchEvent(new PointerEvent(type, { bubbles: true, ...init }));
  });
};

const dragEvent = async ({
  title,
  source = "move",
  startX,
  startY,
  endX,
  endY,
}: {
  title: string;
  source?: "move" | "resize_start" | "resize_end";
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}) => {
  const block = await getEventBlock(title);
  const target =
    source === "move"
      ? block
      : Array.from(block.querySelectorAll("div")).find((node) => {
          const className = node.className;
          return (
            typeof className === "string" &&
            className.includes("cursor-ns-resize") &&
            className.includes(source === "resize_start" ? "top-0" : "bottom-0")
          );
        });

  expect(target).toBeTruthy();

  fireEvent.pointerDown(target!, {
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    clientX: startX,
    clientY: startY,
  });

  dispatchWindowPointer("pointermove", {
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    clientX: endX,
    clientY: endY,
  });
  dispatchWindowPointer("pointerup", {
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
    clientX: endX,
    clientY: endY,
  });
};

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  Settings.now = () => FIXED_NOW.toMillis();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW.toJSDate());

  Element.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.scrollIntoView = () => {};

  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.classList.contains("grid")) {
        return makeRect(0, 0, TIME_GUTTER_WIDTH + DAY_WIDTH * 7, 1488);
      }

      if (this.hasAttribute("data-day-index")) {
        const dayIndex = Number(this.getAttribute("data-day-index"));
        return makeRect(
          TIME_GUTTER_WIDTH + dayIndex * DAY_WIDTH,
          GRID_HEADER_HEIGHT,
          DAY_WIDTH,
          HOUR_HEIGHT * 24,
        );
      }

      if (this.classList.contains("event-block")) {
        const dayCell = this.closest("[data-day-index]");
        if (!dayCell) return makeRect(200, 200, 120, 80);

        const dayIndex = Number(dayCell.getAttribute("data-day-index"));
        const style = (this as HTMLElement).style;
        const percent = (value: string) => (parseFloat(value) || 0) / 100;

        return makeRect(
          TIME_GUTTER_WIDTH +
            dayIndex * DAY_WIDTH +
            percent(style.left) * DAY_WIDTH,
          GRID_HEADER_HEIGHT + (parseFloat(style.top) || 0),
          percent(style.width) * DAY_WIDTH,
          parseFloat(style.height) || 0,
        );
      }

      return originalGetBoundingClientRect.call(this);
    },
  );

  let id = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
    id += 1;
    return `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`;
  });
});

afterEach(() => {
  vi.useRealTimers();
  Settings.now = () => Date.now();
});

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

  it("creates new event on correct day and time", async () => {
    const saveEvents = vi.fn();

    renderCalendar({ mode: "week", saveEvents });

    const cell = getDayCell(4);

    fireEvent.pointerDown(cell, {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(11, 27),
    });

    dispatchWindowPointer("pointerup", {
      button: 0,
      pointerId: 7,
      pointerType: "mouse",
      clientX: dayCenterX(4),
      clientY: timeToClientY(11, 27),
    });

    expect(await screen.findByText("new event")).toBeInTheDocument();

    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].title).toBe("new event");
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("week")
        .plus({ days: 4, hours: 11, minutes: 25 })
        .toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("week")
        .plus({ days: 4, hours: 12, minutes: 25 })
        .toISO(),
    );
  });

  it("edits event title and description with keyboard save", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");

    const titleInput = screen.getByDisplayValue("Planning");
    const descriptionInput = screen.getByDisplayValue("Sprint planning");

    await user.clear(titleInput);
    await user.type(titleInput, "Refined planning");
    await user.clear(descriptionInput);
    await user.type(descriptionInput, "Updated agenda");
    await user.keyboard("{Control>}s{/Control}");

    await advanceSave();

    expect(await screen.findByText("Refined planning")).toBeInTheDocument();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].title).toBe("Refined planning");
    expect(savedEvents[0].description).toBe("Updated agenda");
  });

  it("edits event start and end time", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");

    fireEvent.change(screen.getByDisplayValue("09:00"), {
      target: { value: "11:15" },
    });
    fireEvent.change(screen.getByDisplayValue("10:00"), {
      target: { value: "12:45" },
    });

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 11, minutes: 15 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 12, minutes: 45 }).toISO(),
    );
    expect(await screen.findByText("11:15 AM - 12:45 PM")).toBeInTheDocument();
  });

  it("cancels edit without saving changes", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");

    // necessary at the moment because double clicking triggers save, remove when fixed
    await advanceSave();
    saveEvents.mockClear();

    const titleInput = screen.getByDisplayValue("Planning");
    await user.clear(titleInput);
    await user.type(titleInput, "Discarded title");
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await advanceSave();

    expect(await screen.findByText("Planning")).toBeInTheDocument();
    expect(screen.queryByText("Discarded title")).not.toBeInTheDocument();
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("duplicates event from context menu", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventMenu(user, "Planning");
    await user.click(
      await screen.findByRole("menuitem", { name: /duplicate/i }),
    );

    await advanceSave();

    expect(countEventBlocks("Planning")).toBe(2);

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(2);
    expect(
      savedEvents.filter((event) => event.title === "Planning"),
    ).toHaveLength(2);
    expect(savedEvents[1].repeat).toBeUndefined();
  });

  it("deletes non-recurring event from context menu", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventMenu(user, "Planning");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    await advanceSave();

    expect(screen.queryByText("Planning")).not.toBeInTheDocument();
    expect(getLastSavedEvents(saveEvents)).toHaveLength(0);
  });

  it("moves event to another day", async () => {
    const saveEvents = vi.fn();

    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(4),
      endY: timeToClientY(9),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 9 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 10 }).toISO(),
    );
  });

  it("resizes event end", async () => {
    const saveEvents = vi.fn();

    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Planning",
      source: "resize_end",
      startX: dayCenterX(2),
      startY: timeToClientY(10),
      endX: dayCenterX(2),
      endY: timeToClientY(11),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 9 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 11 }).toISO(),
    );
  });

  it("resizes event start", async () => {
    const saveEvents = vi.fn();

    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Planning",
      source: "resize_start",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(2),
      endY: timeToClientY(8),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 8 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 10 }).toISO(),
    );
  });

  it("prevents resizing start past end", async () => {
    const saveEvents = vi.fn();

    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Planning",
      source: "resize_start",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(2),
      endY: timeToClientY(11),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day")
        .plus({ hours: 10 })
        .minus({ minutes: 5 })
        .toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 10 }).toISO(),
    );
  });

  it("prevents resizing end past start", async () => {
    const saveEvents = vi.fn();

    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Planning",
      source: "resize_end",
      startX: dayCenterX(2),
      startY: timeToClientY(10),
      endX: dayCenterX(2),
      endY: timeToClientY(8),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 9 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 9 }).plus({ minutes: 5 }).toISO(),
    );
  });

  it("updates only selected recurring instance", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Daily standup");

    const titleInput = screen.getByDisplayValue("Daily standup");
    await user.clear(titleInput);
    await user.type(titleInput, "One-off standup");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByText(/update recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    expect(await screen.findByText("One-off standup")).toBeInTheDocument();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(2);

    const parentEvent = savedEvents.find(
      (event) => event.id === "repeat-parent",
    );
    const detachedEvent = savedEvents.find(
      (event) => event.id !== "repeat-parent",
    );

    expect(parentEvent?.title).toBe("Daily standup");
    expect(parentEvent?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 8 }).toISO(),
    );
    expect(parentEvent?.repeat).toEqual({ interval: 1, unit: "day" });
    expect(detachedEvent?.title).toBe("One-off standup");
    expect(detachedEvent?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 8 }).toISO(),
    );
    expect(detachedEvent?.repeat).toBeUndefined();
  });

  it("deletes one recurring instance", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventMenu(user, "Daily standup");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await advanceSave();

    expect(screen.queryByText("Daily standup")).not.toBeInTheDocument();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 8 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 9 }).toISO(),
    );
  });

  it("updates all recurring events", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Daily standup");

    const titleInput = screen.getByDisplayValue("Daily standup");
    await user.clear(titleInput);
    await user.type(titleInput, "Team standup");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByText(/update recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /all events/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    expect(screen.queryByText("Daily standup")).not.toBeInTheDocument();
    expect((await screen.findAllByText("Team standup")).length).toBeGreaterThan(
      1,
    );

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].title).toBe("Team standup");
  });

  it("deletes all recurring events from dialog", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventMenu(user, "Daily standup");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    expect(
      await screen.findByText(/delete recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /all events/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await advanceSave();

    expect(screen.queryByText("Daily standup")).not.toBeInTheDocument();
    expect(getLastSavedEvents(saveEvents)).toHaveLength(0);
  });

  it("deletes future recurring instances from parent", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventMenu(user, "Daily standup");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    expect(
      await screen.findByText(/delete recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /future events/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(0);
  });

  it("deletes parent occurrence with 'this' skips already-skipped dates", async () => {
    const saveEvents = vi.fn();
    const parentStart = FIXED_NOW.startOf("week").plus({ days: 2, hours: 8 });
    const skipDate = parentStart.plus({ days: 1 }).toUTC().toISODate()!;

    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildRecurringEvent({
          repeat: {
            interval: 1,
            unit: "day" as const,
            skip: [skipDate],
          },
        }),
      ],
      saveEvents,
    });

    await openEventMenu(user, "Daily standup");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    expect(
      await screen.findByText(/delete recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /this event/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);

    const parent = savedEvents[0];
    expect(parent.id).toBe("repeat-parent");
    expect(parent.start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 4, hours: 8 }).toISO(),
    );
  });

  it("duplicate of recurring instance strips repeat fields", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventMenu(user, "Daily standup");
    await user.click(
      await screen.findByRole("menuitem", { name: /duplicate/i }),
    );

    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(2);

    const duplicated = savedEvents.find((e) => e.id !== "repeat-parent");
    expect(duplicated?.repeat).toBeUndefined();
    expect(duplicated?._parent).toBeUndefined();
    expect(duplicated?._instanceId).toBeUndefined();
  });

  it("cancel on recurring dialog after drag resets refs", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Daily standup",
      startX: dayCenterX(2),
      startY: timeToClientY(8),
      endX: dayCenterX(2),
      endY: timeToClientY(9),
    });

    expect(
      await screen.findByText(/update recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();

    await dragEvent({
      title: "Daily standup",
      startX: dayCenterX(2),
      startY: timeToClientY(8),
      endX: dayCenterX(4),
      endY: timeToClientY(10),
    });

    expect(
      await screen.findByText(/update recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /this event/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(2);

    const parent = savedEvents.find((e) => e.id === "repeat-parent");
    const detached = savedEvents.find((e) => e.id !== "repeat-parent");

    expect(parent?.start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 3, hours: 8 }).toISO(),
    );
    expect(detached?.start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 4, hours: 10 }).toISO(),
    );
  });

  it("toggles selection with ctrl + click", async () => {
    renderCalendar({ events: [buildPlainEvent()] });

    await ctrlClickEvent("Planning");
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);

    await ctrlClickEvent("Planning");
    expect(isSelected(await getEventBlock("Planning"))).toBe(false);
  });

  it("clears the selection when clicking an unselected event", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });

    await ctrlClickEvent("Planning");
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);

    const other = await getEventBlock("Retro");
    act(() => {
      fireEvent.pointerDown(other, {
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      });
    });
    dispatchWindowPointer("pointerup", { pointerId: 1, pointerType: "mouse" });

    expect(isSelected(await getEventBlock("Planning"))).toBe(false);
  });

  it("moves every selected event when dragging one of them", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(4),
      endY: timeToClientY(9),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 9 }).toISO(),
    );
    expect(retro?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 13 }).toISO(),
    );
    expect(retro?.end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 2, hours: 14 }).toISO(),
    );
  });

  it("deletes every selected event", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await openEventMenu(user, "Planning");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)).toHaveLength(0);
  });

  it("ctrl + drag on empty grid selects without creating an event", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await dragSelectionBox({
      startX: dayCenterX(0),
      startY: timeToClientY(1),
      endX: dayCenterX(6),
      endY: timeToClientY(20),
    });
    await advanceSave();

    expect(countEventBlocks("new event")).toBe(0);
  });

  it("deletes every selected repeating event", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent(), buildSecondRecurringEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Daily standup");
    await ctrlClickEvent("Weekly sync");

    expect(isSelected(await getEventBlock("Daily standup"))).toBe(true);
    expect(isSelected(await getEventBlock("Weekly sync"))).toBe(true);

    await openEventMenu(user, "Daily standup");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);

    const standup = savedEvents.find((e) => e.id === "repeat-parent");
    const sync = savedEvents.find((e) => e.id === "repeat-parent-2");

    expect(standup?.start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 3, hours: 8 }).toISO(),
    );
    expect(sync?.start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 3, hours: 14 }).toISO(),
    );
  });

  it("moves every selected repeating event", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildRecurringEvent(), buildSecondRecurringEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Daily standup");
    await ctrlClickEvent("Weekly sync");

    await dragEvent({
      title: "Daily standup",
      startX: dayCenterX(2),
      startY: timeToClientY(8),
      endX: dayCenterX(4),
      endY: timeToClientY(8),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);

    const detached = savedEvents.filter(
      (e) => e.id !== "repeat-parent" && e.id !== "repeat-parent-2",
    );

    expect(detached).toHaveLength(2);
    expect(detached.map((e) => e.start.hour).sort((a, b) => a - b)).toEqual([
      8, 14,
    ]);
  });

  it("deletes several occurrences of the same repeating event", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await ctrlClickKey("repeat-parent_2026-03-19");
    await ctrlClickKey("repeat-parent_2026-03-20");

    const target = document.querySelector(
      '[data-event-key="repeat-parent_2026-03-19"]',
    ) as HTMLElement;

    await user.pointer({ target, keys: "[MouseRight]" });
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const parent = savedEvents.find((e) => e.id === "repeat-parent");

    expect(parent?.repeat?.skip).toEqual(
      expect.arrayContaining(["2026-03-19", "2026-03-20"]),
    );
  });

  it("applies editor changes to every selected event", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await openEventEditor(user, "Planning");

    const repeatTrigger = screen
      .getAllByText("Does not repeat")
      .map((node) => node.closest("button"))
      .find(Boolean) as HTMLElement;

    await user.click(repeatTrigger);
    await user.click(
      await screen.findByRole("option", { name: /^repeat daily$/i }),
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.repeat).toEqual({ interval: 1, unit: "day" });
    expect(retro?.repeat).toEqual({ interval: 1, unit: "day" });
    expect(retro?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 13 }).toISO(),
    );
  });

  it("changing only the time keeps every selected event on its own day", async () => {
    const saveEvents = vi.fn();
    const retroDay = FIXED_NOW.startOf("day").plus({ days: 1 });
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildPlainEvent(),
        buildEvent({
          id: "second-event",
          title: "Retro",
          description: undefined,
          start: retroDay.plus({ hours: 13 }),
          end: retroDay.plus({ hours: 14 }),
        }),
      ],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await openEventEditor(user, "Planning");

    fireEvent.change(screen.getByDisplayValue("09:00"), {
      target: { value: "03:00" },
    });

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.start.toFormat("HH:mm")).toBe("03:00");
    expect(retro?.start.toFormat("HH:mm")).toBe("03:00");

    expect(retro?.start.hasSame(retroDay, "day")).toBe(true);
    expect(retro?.end.toFormat("HH:mm")).toBe("14:00");
  });

  it("changing only the date moves every selected event to that date, keeping each event's own time", async () => {
    const saveEvents = vi.fn();
    const retroDay = FIXED_NOW.startOf("day").plus({ days: 1 });
    const targetDay = FIXED_NOW.startOf("day").plus({ days: 7 });
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildPlainEvent(),
        buildEvent({
          id: "second-event",
          title: "Retro",
          description: undefined,
          start: retroDay.plus({ hours: 13 }),
          end: retroDay.plus({ hours: 14 }),
        }),
      ],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await openEventEditor(user, "Planning");

    const [startDateButton, endDateButton] = screen.getAllByRole("button", {
      name: "18 Mar 2026",
    });

    await pickCalendarDate(user, startDateButton, targetDay);
    await pickCalendarDate(user, endDateButton, targetDay);

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.start.hasSame(targetDay, "day")).toBe(true);
    expect(planning?.start.toFormat("HH:mm")).toBe("09:00");
    expect(planning?.end.toFormat("HH:mm")).toBe("10:00");

    expect(retro?.start.hasSame(targetDay, "day")).toBe(true);
    expect(retro?.start.toFormat("HH:mm")).toBe("13:00");
    expect(retro?.end.hasSame(targetDay, "day")).toBe(true);
    expect(retro?.end.toFormat("HH:mm")).toBe("14:00");
  });

  it("changing both date and time moves every selected event to that exact date and time", async () => {
    const saveEvents = vi.fn();
    const retroDay = FIXED_NOW.startOf("day").plus({ days: 1 });
    const targetDay = FIXED_NOW.startOf("day").plus({ days: 2 });
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildPlainEvent(),
        buildEvent({
          id: "second-event",
          title: "Retro",
          description: undefined,
          start: retroDay.plus({ hours: 13 }),
          end: retroDay.plus({ hours: 14 }),
        }),
      ],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await openEventEditor(user, "Planning");

    const [startDateButton, endDateButton] = screen.getAllByRole("button", {
      name: "18 Mar 2026",
    });

    await pickCalendarDate(user, startDateButton, targetDay);
    await pickCalendarDate(user, endDateButton, targetDay);

    fireEvent.change(screen.getByDisplayValue("09:00"), {
      target: { value: "03:00" },
    });
    fireEvent.change(screen.getByDisplayValue("10:00"), {
      target: { value: "04:00" },
    });

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.start.toISO()).toBe(targetDay.plus({ hours: 3 }).toISO());
    expect(planning?.end.toISO()).toBe(targetDay.plus({ hours: 4 }).toISO());

    expect(retro?.start.toISO()).toBe(planning?.start.toISO());
    expect(retro?.end.toISO()).toBe(planning?.end.toISO());
  });

  it("selects only the events the box covers", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });

    await dragSelectionBox({
      startX: dayCenterX(2) - DAY_WIDTH / 4,
      startY: timeToClientY(8),
      endX: dayCenterX(2) + DAY_WIDTH / 4,
      endY: timeToClientY(11),
    });

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(false);
  });

  it("keeps the box visible while dragging and removes it on release", async () => {
    renderCalendar({ mode: "week", events: [buildPlainEvent()] });

    startSelectionBox({ x: dayCenterX(2), y: timeToClientY(8) });
    moveSelectionBox({ x: dayCenterX(4), y: timeToClientY(12) });

    const box = getSelectionBox();
    expect(box).toBeTruthy();
    expect(box!.style.left).toBe(`${dayCenterX(2)}px`);
    expect(box!.style.top).toBe(`${timeToClientY(8)}px`);
    expect(box!.style.width).toBe(`${dayCenterX(4) - dayCenterX(2)}px`);
    expect(box!.style.height).toBe(`${timeToClientY(12) - timeToClientY(8)}px`);

    endSelectionBox({ x: dayCenterX(4), y: timeToClientY(12) });

    expect(getSelectionBox()).toBeNull();
  });

  it("removes selection box when pointermove and pointerup land in the same batch", () => {
    renderCalendar({ mode: "week", events: [buildPlainEvent()] });

    startSelectionBox({ x: dayCenterX(2), y: timeToClientY(8) });
    moveSelectionBox({ x: dayCenterX(4), y: timeToClientY(12) });
    expect(getSelectionBox()).toBeTruthy();

    const release = { x: dayCenterX(4) + 1, y: timeToClientY(12) };
    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          pointerType: "mouse",
          ctrlKey: true,
          clientX: release.x,
          clientY: release.y,
        }),
      );

      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          pointerType: "mouse",
          ctrlKey: true,
          clientX: release.x,
          clientY: release.y,
        }),
      );
    });

    expect(getSelectionBox()).toBeNull();
  });

  it("box selection adds to an existing ctrl + click selection", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });

    await ctrlClickEvent("Retro");

    await dragSelectionBox({
      startX: dayCenterX(2) - DAY_WIDTH / 4,
      startY: timeToClientY(8),
      endX: dayCenterX(2) + DAY_WIDTH / 4,
      endY: timeToClientY(11),
    });

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(true);
  });

  it("moves every event caught by the box", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await dragSelectionBox({
      startX: dayCenterX(2) - DAY_WIDTH / 4,
      startY: timeToClientY(8),
      endX: dayCenterX(2) + DAY_WIDTH / 4,
      endY: timeToClientY(15),
    });

    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(3),
      endY: timeToClientY(9),
    });
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 9 }).toISO(),
    );
    expect(retro?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 13 }).toISO(),
    );
  });

  it("starts a selection box from an event block", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });

    startSelectionBox({
      from: await getEventBlock("Planning"),
      x: dayCenterX(2),
      y: timeToClientY(9, 30),
    });
    moveSelectionBox({ x: dayCenterX(2), y: timeToClientY(14) });

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(true);
    expect(getSelectionBox()).toBeTruthy();

    endSelectionBox({ x: dayCenterX(2), y: timeToClientY(14) });

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(true);
  });

  it("does not move an event when ctrl + dragging from it", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });

    await dragSelectionBox({
      from: await getEventBlock("Planning"),
      startX: dayCenterX(2),
      startY: timeToClientY(9, 30),
      endX: dayCenterX(4),
      endY: timeToClientY(14),
    });
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
  });

  it("updates the highlight live as the box grows and shrinks", async () => {
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });

    startSelectionBox({ x: dayCenterX(2), y: timeToClientY(8) });

    moveSelectionBox({ x: dayCenterX(2), y: timeToClientY(14) });
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(true);

    moveSelectionBox({ x: dayCenterX(2), y: timeToClientY(11) });
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(false);

    endSelectionBox({ x: dayCenterX(2), y: timeToClientY(11) });
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(false);
  });

  it("ctrl + press on an event toggles it when the pointer barely moves", async () => {
    renderCalendar({ mode: "week", events: [buildPlainEvent()] });

    startSelectionBox({
      from: await getEventBlock("Planning"),
      x: dayCenterX(2),
      y: timeToClientY(9, 30),
    });
    moveSelectionBox({ x: dayCenterX(2) + 2, y: timeToClientY(9, 30) });
    endSelectionBox({ x: dayCenterX(2) + 2, y: timeToClientY(9, 30) });

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
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

describe("moveHelpers", () => {
  it("getMovedEvent shifts start and end by minutes, hours, days", () => {
    const original = buildEvent({
      id: "e1",
      start: FIXED_NOW.startOf("day").plus({ hours: 9, minutes: 15 }),
      end: FIXED_NOW.startOf("day").plus({ hours: 10, minutes: 15 }),
    });

    const movedMinutes = getMovedEvent(original, "forward", "minutes", 30);
    expect(movedMinutes.start.toISO()).toBe(
      original.start.plus({ minutes: 30 }).toISO(),
    );
    expect(movedMinutes.end.toISO()).toBe(
      original.end.plus({ minutes: 30 }).toISO(),
    );

    const movedHours = getMovedEvent(original, "backward", "hours", 2);
    expect(movedHours.start.toISO()).toBe(
      original.start.minus({ hours: 2 }).toISO(),
    );
    expect(movedHours.end.toISO()).toBe(
      original.end.minus({ hours: 2 }).toISO(),
    );

    const movedDays = getMovedEvent(original, "forward", "days", 1);
    expect(movedDays.start.toISO()).toBe(
      original.start.plus({ days: 1 }).toISO(),
    );
    expect(movedDays.end.toISO()).toBe(original.end.plus({ days: 1 }).toISO());
  });

  it("findFreeSlotForEvent finds next free slot forward skipping conflicts", () => {
    const target = buildEvent({
      id: "target",
      start: FIXED_NOW.startOf("day").plus({ hours: 9 }),
      end: FIXED_NOW.startOf("day").plus({ hours: 10 }),
    });

    const conflicts: CalendarEvent[] = [];
    for (let i = 0; i < 10; i++) {
      conflicts.push(
        buildEvent({
          id: `conflict${i}`,
          start: FIXED_NOW.startOf("day").plus({ hours: i + 9 }),
          end: FIXED_NOW.startOf("day").plus({ hours: i + 10 }),
        }),
      );
    }

    const slot = findFreeSlotForEvent(
      [target, ...conflicts],
      target,
      "forward",
    );
    expect(slot).not.toBeNull();
    expect(slot?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 19 }).toISO(),
    );
    expect(slot?.end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 20 }).toISO(),
    );
  });

  it("findFreeSlotForEvent finds previous free slot backward skipping conflicts", () => {
    const target = buildEvent({
      id: "target2",
      start: FIXED_NOW.startOf("day").plus({ hours: 9 }),
      end: FIXED_NOW.startOf("day").plus({ hours: 10 }),
    });

    const conflicts: CalendarEvent[] = [];

    for (let i = 0; i < 10; i++) {
      const conflict = buildEvent({
        id: `conflict${i}`,
        start: FIXED_NOW.startOf("day").plus({ hours: i }),
        end: FIXED_NOW.startOf("day").plus({ hours: i + 1 }),
      });
      conflicts.push(conflict);
    }

    const slot = findFreeSlotForEvent(
      [target, ...conflicts],
      target,
      "backward",
    );
    expect(slot).not.toBeNull();
    expect(slot?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").minus({ hours: 1 }).toISO(),
    );
    expect(slot?.end.toISO()).toBe(FIXED_NOW.startOf("day").toISO());
  });

  it("findFreeSlotForEvent respects repeating events occurrences", () => {
    const target = buildEvent({
      id: "target3",
      start: FIXED_NOW.startOf("week").plus({ days: 2, hours: 9 }),
      end: FIXED_NOW.startOf("week").plus({ days: 2, hours: 10 }),
    });

    const repeating = buildEvent({
      id: "repeat-parent",
      start: FIXED_NOW.startOf("week").plus({ days: 1, hours: 10 }),
      end: FIXED_NOW.startOf("week").plus({ days: 1, hours: 11 }),
      repeat: { interval: 1, unit: "day" as const },
    });

    const slot = findFreeSlotForEvent([target, repeating], target, "forward");
    expect(slot).not.toBeNull();
    // should skip 10-11 occurrence and return 11-12 on same day
    expect(slot?.start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 2, hours: 11 }).toISO(),
    );
  });
});
