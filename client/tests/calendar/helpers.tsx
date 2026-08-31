import { afterEach, beforeEach, expect, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTime, Settings } from "luxon";

vi.mock("../../src/components/ui/sidebar.tsx", () => {
  return {
    SidebarTrigger: () => null,
  };
});

// sonner is mocked globally in tests/setup.ts
import AppCalendar from "../../src/components/calendar/Calendar.tsx";
import { CalendarProvider } from "../../src/context/CalendarContext.tsx";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";

export const FIXED_NOW = DateTime.fromISO("2026-03-18T10:30:00");
export const TODAY_LABEL = FIXED_NOW.toFormat("EEE d");

export const WEEK_LABELS = Array.from({ length: 7 }, (_, i) =>
  FIXED_NOW.startOf("week").plus({ days: i }).toFormat("EEE d"),
);
export const GRID_HEADER_HEIGHT = 48;
export const HOUR_HEIGHT = 60;
export const TIME_GUTTER_WIDTH = 64;
export const DAY_WIDTH = 100;
export const HOUR_LABELS = Array.from(
  { length: 24 },
  (_, i) => `${((i + 11) % 12) + 1} ${i < 12 ? "AM" : "PM"}`,
);

export const buildEvent = (
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id: "plain-event",
  title: "Planning",
  description: "Sprint planning",
  start: FIXED_NOW.startOf("day").plus({ hours: 9 }),
  end: FIXED_NOW.startOf("day").plus({ hours: 10 }),
  timestamp: FIXED_NOW.toMillis(),
  ...overrides,
});

export const buildPlainEvent = (): CalendarEvent => buildEvent();

export const buildSecondEvent = (): CalendarEvent =>
  buildEvent({
    id: "second-event",
    title: "Retro",
    description: undefined,
    start: FIXED_NOW.startOf("day").plus({ hours: 13 }),
    end: FIXED_NOW.startOf("day").plus({ hours: 14 }),
  });

export const buildSecondRecurringEvent = (): CalendarEvent =>
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

export const buildRecurringEvent = (
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

export const renderCalendar = ({
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
        syncBuckets={vi.fn()}
        saveDebounceMs={0}
      />
    </CalendarProvider>,
  );

  return { user, saveEvents, setMode, ...renderResult };
};

export const advanceSave = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

export const getLastSavedEvents = (saveEvents: ReturnType<typeof vi.fn>) => {
  expect(saveEvents).toHaveBeenCalled();
  return saveEvents.mock.lastCall?.[0] as CalendarEvent[];
};

export const getDayCell = (dayIndex = 0) => {
  const cell = document.querySelector(
    `.grid-cell[data-day-index="${dayIndex}"]`,
  ) as HTMLDivElement | null;

  expect(cell).toBeTruthy();
  return cell!;
};

export const getEventBlock = async (title: string) => {
  const labels = await screen.findAllByText(title);
  const label =
    labels.find((node) => node.closest(".event-block")) ?? labels[0];
  const block = label.closest(".event-block") as HTMLDivElement | null;

  expect(block).toBeTruthy();
  return block!;
};

export const openEventEditor = async (
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) => {
  await user.dblClick(await getEventBlock(title));
  expect(
    await screen.findByRole("heading", { name: /edit event/i }),
  ).toBeInTheDocument();
};

export const openEventMenu = async (
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) => {
  await user.pointer({
    target: await getEventBlock(title),
    keys: "[MouseRight]",
  });
};

export const pickCalendarDate = async (
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

export const ctrlClick = (block: Element, clientX = 0, clientY = 0) => {
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

export const ctrlClickEvent = async (title: string) => {
  ctrlClick(await getEventBlock(title));
};

export const ctrlClickKey = async (key: string) => {
  const block = document.querySelector(
    `[data-event-key="${key}"]`,
  ) as HTMLElement | null;

  expect(block).toBeTruthy();
  ctrlClick(block!);
};

export const isSelected = (block: Element) =>
  (block as HTMLElement).style.boxShadow.includes("inset");

export const getSelectionBox = () =>
  document.querySelector(".selection-box") as HTMLElement | null;

export const startSelectionBox = ({
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

export const moveSelectionBox = ({ x, y }: { x: number; y: number }) =>
  dispatchWindowPointer("pointermove", {
    pointerId: 1,
    pointerType: "mouse",
    ctrlKey: true,
    clientX: x,
    clientY: y,
  });

export const endSelectionBox = ({ x, y }: { x: number; y: number }) =>
  dispatchWindowPointer("pointerup", {
    pointerId: 1,
    pointerType: "mouse",
    ctrlKey: true,
    clientX: x,
    clientY: y,
  });

export const dragSelectionBox = async ({
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

export const countEventBlocks = (title: string) =>
  Array.from(document.querySelectorAll(".event-block")).filter((node) =>
    node.textContent?.includes(title),
  ).length;

export const makeRect = (
  left: number,
  top: number,
  width: number,
  height: number,
) =>
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

export const dayCenterX = (dayIndex: number) =>
  TIME_GUTTER_WIDTH + DAY_WIDTH * dayIndex + DAY_WIDTH / 2;

export const timeToClientY = (hour: number, minute = 0) =>
  GRID_HEADER_HEIGHT + hour * HOUR_HEIGHT + minute;

export const dispatchWindowPointer = (
  type: "pointermove" | "pointerup",
  init: PointerEventInit,
) => {
  act(() => {
    window.dispatchEvent(new PointerEvent(type, { bubbles: true, ...init }));
  });
};

export const dragEvent = async ({
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

// registers the fake timers, DOM measurement, and crypto mocks the calendar
// grid needs; call once at the top of each test file that renders it
export const setupCalendarTests = () => {
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
};
