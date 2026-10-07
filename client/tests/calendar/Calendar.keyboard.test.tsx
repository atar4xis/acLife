import { describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AppCalendar from "../../src/components/calendar/Calendar.tsx";
import { CalendarProvider } from "../../src/context/CalendarContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import {
  FIXED_NOW,
  advanceSave,
  buildEvent,
  buildPlainEvent,
  countEventBlocks,
  dayCenterX,
  dispatchWindowPointer,
  getDayCell,
  getEventBlock,
  openEventMenu,
  getLastSavedEvents,
  isSelected,
  renderCalendar,
  setupCalendarTests,
  timeToClientY,
} from "./helpers";
import { spoken, activeElement, focusGrid, grid } from "./gridKeyboardHelpers";
import { slotDomId } from "../../src/lib/calendar/gridFocus.ts";
import { seedSettings } from "../settingsStorage.ts";

setupCalendarTests();

const today = FIXED_NOW.startOf("day");
const activeId = () => grid().getAttribute("aria-activedescendant");
const slot = () => document.getElementById(activeId()!)!;

const overlapping = () => [
  buildPlainEvent(),
  buildEvent({
    id: "overlap",
    title: "Overlap",
    start: today.plus({ hours: 9, minutes: 30 }),
    end: today.plus({ hours: 10, minutes: 30 }),
  }),
];

describe("Calendar grid keyboard: focus model", () => {
  it("makes the grid the only tab stop", async () => {
    renderCalendar({ mode: "week", events: overlapping() });
    await screen.findByText("Planning");

    const stops = grid().querySelectorAll("[tabindex]:not([tabindex='-1'])");
    expect(stops).toHaveLength(0);
    expect(grid()).toHaveAttribute("tabindex", "0");
    expect(
      screen
        .getAllByRole("columnheader")
        .every((h) => !h.hasAttribute("tabindex")),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("rowheader")
        .every((h) => !h.hasAttribute("tabindex")),
    ).toBe(true);
  });

  it("starts at the current time and announces the slot", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();

    expect(spoken()).toBe("10:30 AM, Wednesday 18 March 2026, today");
    expect(slot()).toHaveAccessibleName(
      "10:30 AM, Wednesday 18 March 2026, today",
    );
    expect(slot().style.top).toBe("630px");
  });

  it("marks only the focused slot, in the focused day column", async () => {
    renderCalendar({ mode: "week" });
    await screen.findByText("Wed 18");
    focusGrid();

    expect(document.querySelectorAll('[id^="calendar-slot-"]')).toHaveLength(1);
    expect(
      getDayCell(2).querySelector('[id^="calendar-slot-"]'),
    ).not.toBeNull();
  });

  it("gives every slot its own id so screen readers announce each move", async () => {
    const { user } = renderCalendar({ mode: "week" });
    await screen.findByText("Wed 18");
    focusGrid();
    const ids = [activeId()];

    for (const key of [
      "{ArrowDown}",
      "{ArrowDown}",
      "{ArrowRight}",
      "{ArrowUp}",
    ]) {
      await user.keyboard(key);
      ids.push(activeId());
    }

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.at(-1)).toBe(slotDomId(3, 635));
    expect(document.getElementById(ids.at(-1)!)).not.toBeNull();
  });

  it("renders a new element for every slot, not the same one with a new id", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    const first = slot();
    await user.keyboard("{ArrowDown}");

    expect(slot()).not.toBe(first);
    expect(first.isConnected).toBe(false);
  });

  it("always points at an element that exists", async () => {
    const { user } = renderCalendar({ mode: "week" });
    await screen.findByText("Wed 18");
    focusGrid();

    for (const key of [
      "{ArrowDown}",
      "{PageDown}",
      "{ArrowLeft}",
      "{End}",
      "{Home}",
    ]) {
      await user.keyboard(key);
      expect(document.getElementById(activeId()!)).not.toBeNull();
    }
  });

  it("speaks through the active descendant only, with no live region", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{ }");

    expect(document.querySelector("[aria-live], [role=status]")).toBeNull();
  });

  it("hides the focus indicator until keyboard mode", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();

    expect(slot().className).toContain("opacity-0");
    expect(slot().className).toContain(
      "group-data-keyboard-mode/grid:opacity-100",
    );
    expect(grid().className).toContain("group/grid");
    expect(grid().className).toContain("outline-none");
  });

  it("drops the active descendant outside keyboard mode", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    const indicator = slot();
    expect(indicator).not.toHaveAttribute("aria-hidden");

    act(() => grid().blur());

    expect(indicator).toHaveAttribute("aria-hidden", "true");
    expect(activeId()).toBeNull();
  });

  it("keeps the focus indicator out of pointer hit testing", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();

    expect(slot().className).toContain("pointer-events-none");
  });

  it("restores the previous slot when the grid is focused again", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    await user.keyboard("{ArrowDown}");
    act(() => grid().blur());
    focusGrid();

    expect(spoken()).toContain("10:35 AM");
  });
});

describe("Calendar grid keyboard: movement", () => {
  it("steps by snapMinutes with Up/Down", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();

    await user.keyboard("{ArrowDown}");
    expect(spoken()).toBe("10:35 AM, Wednesday 18 March 2026, today");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(spoken()).toBe("10:25 AM, Wednesday 18 March 2026, today");
  });

  it.each([
    [5, "10:35 AM"],
    [15, "10:45 AM"],
    [30, "11 AM"],
  ])("uses snapMinutes %i for a step", async (snapMinutes, expected) => {
    seedSettings({ snapMinutes });
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    await user.keyboard("{ArrowDown}");

    expect(spoken()).toContain(expected);
  });

  it("aligns the starting slot to snapMinutes", async () => {
    seedSettings({ snapMinutes: 60 });
    renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();

    expect(spoken()).toContain("10 AM");
  });

  it("moves an hour with PageUp/PageDown", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();

    await user.keyboard("{PageDown}");
    expect(spoken()).toContain("11:30 AM");
    await user.keyboard("{PageUp}{PageUp}");
    expect(spoken()).toContain("9:30 AM");
  });

  it("jumps to the start and end of the day, and back to now with Ctrl+Home", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();

    await user.keyboard("{Home}");
    expect(spoken()).toContain("12 AM");
    await user.keyboard("{End}");
    expect(spoken()).toContain("11:55 PM");
    await user.keyboard("{Control>}{Home}{/Control}");
    expect(spoken()).toBe("10:30 AM, Wednesday 18 March 2026, today");
  });

  it("moves between days with Left/Right in week view", async () => {
    const { user } = renderCalendar({ mode: "week" });
    await screen.findByText("Wed 18");
    focusGrid();

    await user.keyboard("{ArrowRight}");
    expect(spoken()).toBe("10:30 AM, Thursday 19 March 2026");
    expect(
      getDayCell(3).querySelector('[id^="calendar-slot-"]'),
    ).not.toBeNull();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(spoken()).toBe("10:30 AM, Tuesday 17 March 2026");
  });

  it("wraps into the next and previous week at the edges", async () => {
    const { user } = renderCalendar({ mode: "week" });
    await screen.findByText("Wed 18");
    focusGrid();

    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(spoken()).toBe("10:30 AM, Sunday 22 March 2026");
    await user.keyboard("{ArrowRight}");
    expect(spoken()).toBe("10:30 AM, Monday 23 March 2026");
    expect(await screen.findByText("Mon 23")).toBeInTheDocument();
    expect(
      getDayCell(0).querySelector('[id^="calendar-slot-"]'),
    ).not.toBeNull();

    await user.keyboard("{ArrowLeft}");
    expect(spoken()).toBe("10:30 AM, Sunday 22 March 2026");
    expect(await screen.findByText("Sun 22")).toBeInTheDocument();
    expect(
      getDayCell(6).querySelector('[id^="calendar-slot-"]'),
    ).not.toBeNull();
  });

  it("changes the date with Left/Right in day view", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();

    await user.keyboard("{ArrowRight}");
    expect(await screen.findByText("Thu 19")).toBeInTheDocument();
    expect(spoken()).toBe("10:30 AM, Thursday 19 March 2026");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(await screen.findByText("Tue 17")).toBeInTheDocument();
  });

  it("returns to today with Ctrl+Home from another week", async () => {
    const { user } = renderCalendar({ mode: "week" });
    await screen.findByText("Wed 18");
    focusGrid();

    await user.keyboard(
      "{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}",
    );
    expect(await screen.findByText("Mon 23")).toBeInTheDocument();
    await user.keyboard("{Control>}{Home}{/Control}");

    expect(spoken()).toBe("10:30 AM, Wednesday 18 March 2026, today");
    expect(await screen.findByText("Wed 18")).toBeInTheDocument();
    expect(
      getDayCell(2).querySelector('[id^="calendar-slot-"]'),
    ).not.toBeNull();
  });

  it("returns to today in day view with Ctrl+Home", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();

    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(await screen.findByText("Fri 20")).toBeInTheDocument();
    await user.keyboard("{Control>}{Home}{/Control}");
    expect(await screen.findByText("Wed 18")).toBeInTheDocument();
    expect(spoken()).toBe("10:30 AM, Wednesday 18 March 2026, today");
  });

  it("starts at the first visible hour when today is not shown", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    await user.click(screen.getByTestId("next-btn"));
    await screen.findByText("Thu 19");
    grid().scrollTop = 120;
    focusGrid();

    expect(spoken()).toBe("2 AM, Thursday 19 March 2026");
  });

  it.each([
    ["top", "left"],
    ["bottom", "right"],
    ["top", "right"],
    ["bottom", "left"],
  ] as const)(
    "moves the same way with header %s and labels %s",
    async (dayHeaderPosition, timeLabelPosition) => {
      seedSettings({ dayHeaderPosition, timeLabelPosition });
      const { user } = renderCalendar({ mode: "week" });
      await screen.findByText("Wed 18");
      focusGrid();

      await user.keyboard("{ArrowDown}{ArrowRight}");
      expect(spoken()).toBe("10:35 AM, Thursday 19 March 2026");
      expect(
        getDayCell(3).querySelector('[id^="calendar-slot-"]'),
      ).not.toBeNull();
      expect(grid().querySelectorAll("[tabindex='0']")).toHaveLength(0);
    },
  );

  it("leaves Alt, Meta and Ctrl+Shift arrow combinations alone", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    const before = spoken();

    await user.keyboard("{Control>}{Shift>}{ArrowDown}{/Shift}{/Control}");
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await user.keyboard("{Meta>}{ArrowDown}{/Meta}");

    expect(spoken()).toBe(before);
  });

  it("lists the events in the announced slot", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();

    await user.keyboard("{PageUp}");
    expect(spoken()).toBe(
      "9:30 AM, Wednesday 18 March 2026, today, 2 events: Planning, Overlap",
    );
    expect(slot()).toHaveAccessibleName(spoken());
    await user.keyboard("{PageUp}");
    expect(spoken()).toBe("8:30 AM, Wednesday 18 March 2026, today");
  });

  it("speaks the slot again when a key does not move it", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    await user.keyboard("{Home}");
    const first = activeElement();
    await user.keyboard("{Home}");

    expect(activeElement()).not.toBe(first);
    expect(spoken()).toContain("12 AM");
  });

  it("does not handle keys typed in the editor inside the grid", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await user.dblClick(await getEventBlock("Planning"));
    const title = await screen.findByPlaceholderText("Planning");
    await user.click(title);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(
      screen.getByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();
    expect(grid()).not.toHaveAttribute("aria-activedescendant");
  });
});

describe("Calendar grid keyboard: scrolling", () => {
  const setup = (headerBottom = false) => {
    const scrollTo = vi.fn();
    const { user } = renderCalendar();
    const g = grid();
    g.scrollTo = scrollTo;
    Object.defineProperty(g, "clientHeight", {
      value: 600,
      configurable: true,
    });
    return { user, scrollTo, headerBottom };
  };

  it("scrolls the slot into view with smooth scrolling", async () => {
    const { user, scrollTo } = setup();
    await screen.findByText("Wed 18");
    focusGrid();
    scrollTo.mockClear();

    await user.keyboard("{End}");
    // slot bottom = 48 header + 1440 => 1488 - 600
    expect(scrollTo).toHaveBeenCalledWith({ top: 888, behavior: "smooth" });
  });

  it("scrolls instantly when reduced motion is preferred", async () => {
    const original = window.matchMedia;
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      const { user, scrollTo } = setup();
      await screen.findByText("Wed 18");
      focusGrid();
      scrollTo.mockClear();

      await user.keyboard("{End}");
      expect(scrollTo).toHaveBeenCalledWith({ top: 888, behavior: "instant" });
    } finally {
      vi.stubGlobal("matchMedia", original);
    }
  });

  it("does not scroll when the slot is already visible", async () => {
    const { user, scrollTo } = setup();
    await screen.findByText("Wed 18");
    grid().scrollTop = 500;
    focusGrid();
    scrollTo.mockClear();

    await user.keyboard("{ArrowDown}");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not scroll when the slot starts exactly at the top edge", async () => {
    const { scrollTo } = setup();
    await screen.findByText("Wed 18");
    // 10:30 sits 630px below the first hour
    grid().scrollTop = 630;
    focusGrid();

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls up under the sticky header", async () => {
    const { user, scrollTo } = setup();
    await screen.findByText("Wed 18");
    grid().scrollTop = 800;
    focusGrid();
    scrollTo.mockClear();

    await user.keyboard("{Home}");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("accounts for a bottom header", async () => {
    seedSettings({ dayHeaderPosition: "bottom" });
    const { user, scrollTo } = setup();
    await screen.findByText("Wed 18");
    focusGrid();
    scrollTo.mockClear();

    await user.keyboard("{End}");
    // slot bottom 1440 + 48 header - 600
    expect(scrollTo).toHaveBeenCalledWith({ top: 888, behavior: "smooth" });
  });

  it("scrolls the initial slot into view when the grid gets focus", async () => {
    const { scrollTo } = setup();
    await screen.findByText("Wed 18");
    focusGrid();

    // 10:30 slot bottom = 48 header + 635 => 683 - 600
    expect(scrollTo).toHaveBeenCalledWith({ top: 83, behavior: "smooth" });
  });
});

describe("Calendar grid keyboard: jumping between events", () => {
  const laterDay = () =>
    buildEvent({
      id: "later",
      title: "Later",
      start: today.plus({ days: 1, hours: 8 }),
      end: today.plus({ days: 1, hours: 9 }),
    });

  it("moves to the previous and next event with Ctrl+Up and Ctrl+Down", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();

    await user.keyboard("{Control>}{ArrowUp}{/Control}");
    expect(slot()).toHaveAccessibleName(/^Overlap, /);
    await user.keyboard("{Control>}{ArrowUp}{/Control}");
    expect(slot()).toHaveAccessibleName(/^Planning, /);
    await user.keyboard("{Control>}{ArrowDown}{/Control}");
    expect(slot()).toHaveAccessibleName(/^Overlap, /);
  });

  it("lands on the event, so Enter opens it", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{Control>}{ArrowUp}{/Control}{Enter}{Enter}");

    expect(screen.getByRole("dialog", { name: "Edit event" })).toBeVisible();
    expect(screen.getByDisplayValue("Overlap")).toBeInTheDocument();
  });

  it("crosses into the next day in week view", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [...overlapping(), laterDay()],
    });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{Control>}{ArrowDown}{/Control}");

    expect(slot()).toHaveAccessibleName(/^Later, /);
    expect(activeId()).toMatch(/^calendar-event-later-3$/);
  });

  it("says when there is no earlier or later event", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();

    await user.keyboard("{Control>}{ArrowDown}{/Control}");
    expect(spoken()).toBe("No later events");
    expect(slot()).toHaveAccessibleName("No later events");

    await user.keyboard("{Control>}{ArrowUp}{ArrowUp}{ArrowUp}{/Control}");
    expect(spoken()).toBe("No earlier events");
    expect(slot()).toHaveAccessibleName("No earlier events");
  });

  it("reads the slot again once the notice is gone", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{Control>}{ArrowDown}{/Control}{ArrowDown}");

    expect(slot()).toHaveAccessibleName(/^10:35 AM, /);
    expect(document.querySelector('[id^="calendar-spoken-"]')).toBeNull();
  });

  it("scrolls to the event", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    const scrollTo = vi.fn();
    grid().scrollTo = scrollTo;
    grid().scrollTop = 1000;
    Object.defineProperty(grid(), "clientHeight", { value: 600 });
    await user.keyboard("{Control>}{ArrowUp}{/Control}");

    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ top: 570 }),
    );
  });
});

describe("Calendar grid keyboard: context menu", () => {
  const openMenuKey = (init: KeyboardEventInit) =>
    fireEvent.keyDown(grid(), init);

  const focusPlanning = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}");
  };

  it.each([
    ["the Menu key", { key: "ContextMenu" }],
    ["Shift+F10", { key: "F10", shiftKey: true }],
  ])("opens the focused event's menu with %s", async (_name, init) => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await focusPlanning(user);

    expect(openMenuKey(init)).toBe(false);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Planning", { selector: "[role=menu] *" }));
    expect(screen.getByRole("menuitem", { name: /edit/i })).toBeInTheDocument();
  });

  it("opens the menu at the event", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await focusPlanning(user);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 300,
      bottom: 360,
      left: 100,
      right: 300,
      width: 200,
      height: 60,
      x: 100,
      y: 300,
      toJSON: () => ({}),
    });
    const seen = vi.fn();
    document.addEventListener("contextmenu", seen);
    openMenuKey({ key: "ContextMenu" });
    document.removeEventListener("contextmenu", seen);

    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({ clientX: 200, clientY: 316 }),
    );
  });

  it("keeps the browser's own menu from opening for the same key press", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await focusPlanning(user);
    openMenuKey({ key: "ContextMenu" });
    await screen.findByRole("menu");

    expect(fireEvent.contextMenu(document.body)).toBe(false);
    expect(fireEvent.contextMenu(screen.getByRole("menu"))).toBe(false);
  });

  it("lets the browser's menu through again afterwards", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await focusPlanning(user);
    openMenuKey({ key: "ContextMenu" });
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(fireEvent.contextMenu(document.body)).toBe(true);
  });

  it("leaves the key alone when the focus is on an empty slot", async () => {
    renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    focusGrid();

    expect(openMenuKey({ key: "ContextMenu" })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("gives the focus back to the event when the menu closes", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await focusPlanning(user);
    const active = activeId();
    openMenuKey({ key: "ContextMenu" });
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(grid()).toHaveFocus());
    expect(grid()).toHaveAttribute("data-keyboard-mode");
    expect(activeId()).toBe(active);
  });

  it("opens the editor from the menu with the keyboard only", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await focusPlanning(user);
    openMenuKey({ key: "ContextMenu" });
    await screen.findByRole("menu");
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("dialog", { name: "Edit event" }),
    ).toBeInTheDocument();
  });

  it("keeps the browser's own menu off the grid in keyboard mode only", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    expect(fireEvent.contextMenu(grid())).toBe(true);
    focusGrid();

    expect(fireEvent.contextMenu(grid())).toBe(false);
  });
});

describe("Calendar grid keyboard: events", () => {
  it("creates an event on Enter in an empty slot, like a tap", async () => {
    const keyboardSave = vi.fn();
    const { user, unmount } = renderCalendar({ saveEvents: keyboardSave });
    await screen.findByText("Wed 18");
    focusGrid();
    await user.keyboard("{Enter}");
    await advanceSave();
    const keyboardEvent = getLastSavedEvents(keyboardSave)[0];
    expect(spoken()).toBe(
      "Created new event, 10:30 AM, Wednesday 18 March 2026, today",
    );
    expect(slot()).toHaveAccessibleName(spoken());
    unmount();

    const tapSave = vi.fn();
    renderCalendar({ saveEvents: tapSave });
    await screen.findByText("Wed 18");
    const init = {
      button: 0,
      pointerId: 3,
      pointerType: "mouse",
      clientX: dayCenterX(0),
      clientY: timeToClientY(10, 30),
    };
    fireEvent.pointerDown(getDayCell(0), init);
    dispatchWindowPointer("pointerup", init);
    await advanceSave();
    const tapEvent = getLastSavedEvents(tapSave)[0];

    const strip = ({ id, timestamp, ...rest }: Record<string, unknown>) => {
      void id;
      void timestamp;
      return rest;
    };
    expect(strip(keyboardEvent)).toEqual(strip(tapEvent));
    expect(keyboardEvent.start.toISO()).toBe(
      today.plus({ hours: 10, minutes: 30 }).toISO(),
    );
    expect(keyboardEvent.end.diff(keyboardEvent.start, "minutes").minutes).toBe(
      60,
    );
  });

  it("uses the configured default duration and snap when creating", async () => {
    seedSettings({ defaultEventDuration: 45, snapMinutes: 30 });
    const saveEvents = vi.fn();
    const { user } = renderCalendar({ saveEvents });
    await screen.findByText("Wed 18");
    focusGrid();
    await user.keyboard("{Enter}");
    await advanceSave();

    const created = getLastSavedEvents(saveEvents)[0];
    expect(created.start.toISO()).toBe(
      today.plus({ hours: 10, minutes: 30 }).toISO(),
    );
    expect(created.end.diff(created.start, "minutes").minutes).toBe(45);
  });

  it("supports undo after keyboard creation", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("new event")).toBeInTheDocument();

    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() =>
      expect(screen.queryByText("new event")).not.toBeInTheDocument(),
    );
  });

  it("clears the selection when creating", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{ }");
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    await user.keyboard("{Home}{Enter}");

    expect(await screen.findByText("new event")).toBeInTheDocument();
    expect(isSelected(await getEventBlock("Planning"))).toBe(false);
  });

  it("moves focus into the first event on Enter in an occupied slot", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}");

    const planning = await getEventBlock("Planning");
    expect(activeId()).toBe(planning.id);
    expect(screen.queryByText("new event")).not.toBeInTheDocument();
  });

  it("cycles overlapping events with Tab and Shift+Tab without trapping focus", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}");
    const planning = await getEventBlock("Planning");
    const overlap = await getEventBlock("Overlap");

    await user.keyboard("{Tab}");
    expect(activeId()).toBe(overlap.id);
    expect(grid()).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(activeId()).toBe(planning.id);
    expect(grid()).toHaveFocus();

    await user.keyboard("{Tab}{Tab}");
    expect(grid()).not.toHaveFocus();
  });

  it("opens the editor on Enter for a focused event", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Enter}{Enter}");

    expect(
      await screen.findByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Planning")).toBeInTheDocument();
  });

  it("leaves event focus with the arrow keys", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}");
    await user.keyboard("{ArrowDown}");

    expect(activeId()).toBe(slotDomId(0, 575));
    expect(spoken()).toContain("9:35 AM");
  });

  it("marks the focused event only", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}");
    const planning = await getEventBlock("Planning");
    const overlap = await getEventBlock("Overlap");

    expect(planning.className).toContain(
      "group-data-keyboard-mode/grid:outline-2",
    );
    expect(overlap.className).not.toContain(
      "group-data-keyboard-mode/grid:outline-2",
    );
    await user.keyboard("{Tab}");
    expect(planning.className).not.toContain(
      "group-data-keyboard-mode/grid:outline-2",
    );
    expect(overlap.className).toContain(
      "group-data-keyboard-mode/grid:outline-2",
    );
  });

  it("toggles selection of the focused event with Space", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{ }");

    const planning = await getEventBlock("Planning");
    expect(isSelected(planning)).toBe(true);
    expect(spoken()).toBe("Planning selected");
    expect(slot()).toHaveAccessibleName("Planning selected");
    await user.keyboard("{ }");
    expect(isSelected(planning)).toBe(false);
    expect(spoken()).toBe("Planning deselected");
    expect(slot()).toHaveAccessibleName("Planning deselected");
  });

  it("does nothing on Space in an empty slot", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{ }");

    expect(isSelected(await getEventBlock("Planning"))).toBe(false);
  });

  it("extends the selection with Shift+Arrow", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Shift>}{ArrowDown}{/Shift}");

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Overlap"))).toBe(true);
    expect(spoken()).toContain("2 selected");
    expect(slot()).toHaveAccessibleName(spoken());
  });

  it("selects an event entered with Shift+Arrow from an empty slot", async () => {
    seedSettings({ snapMinutes: 30 });
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    focusGrid();

    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(isSelected(await getEventBlock("Planning"))).toBe(false);
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(spoken()).toContain("1 selected");
  });

  it("keeps the selection and adds to it across Shift+Arrow presses", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{ }");
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Overlap"))).toBe(true);
  });

  it("deletes the focused event with Delete and undoes it", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Delete}");
    await advanceSave();

    expect(screen.queryByText("Planning")).not.toBeInTheDocument();
    expect(getLastSavedEvents(saveEvents)).toHaveLength(0);

    await user.keyboard("{Control>}z{/Control}");
    expect(await screen.findByText("Planning")).toBeInTheDocument();
  });

  it("deletes the selection, not just the focused event, with Delete", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{ }{Tab}{ }{Delete}");

    expect(screen.queryByText("Planning")).not.toBeInTheDocument();
    expect(screen.queryByText("Overlap")).not.toBeInTheDocument();
  });

  it("falls back to the slot when the focused event disappears", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Delete}");

    expect(screen.queryByText("Planning")).not.toBeInTheDocument();
    expect(activeId()).toBe(slotDomId(0, 570));
    expect(document.querySelector('[id^="calendar-slot-"]')).not.toBeNull();
  });

  it("copies and pastes the selection with the existing shortcuts", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    // a tall viewport keeps the grid from scrolling, which would shift the paste position
    Object.defineProperty(grid(), "clientHeight", { value: 5000 });
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{ }{Control>}c{/Control}");
    fireEvent.pointerMove(getDayCell(0), {
      pointerId: 9,
      pointerType: "mouse",
      clientX: dayCenterX(0),
      clientY: timeToClientY(14, 0),
    });
    await user.keyboard("{Control>}v{/Control}");

    await waitFor(() => expect(countEventBlocks("Planning")).toBe(2));
  });

  it("toggles a task with Ctrl+Enter", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      saveEvents,
      events: [
        buildEvent({
          id: "task",
          title: "Pay rent",
          isTask: true,
          start: today.plus({ hours: 10, minutes: 30 }),
          end: today.plus({ hours: 11 }),
        }),
      ],
    });
    await screen.findByText("Pay rent");
    focusGrid();
    await user.keyboard("{Enter}{Control>}{Enter}{/Control}");
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0]).toMatchObject({
      completed: true,
    });
    expect(spoken()).toBe("Pay rent completed");
    expect(slot()).toHaveAccessibleName("Pay rent completed");
    expect(
      screen.getByRole("group", { name: /task, completed$/ }),
    ).toBeInTheDocument();
    await user.keyboard("{Control>}{Enter}{/Control}");
    await advanceSave();
    expect(spoken()).toBe("Pay rent not completed");
    expect(slot()).toHaveAccessibleName("Pay rent not completed");
    expect(getLastSavedEvents(saveEvents)[0]).toMatchObject({
      completed: false,
    });
  });

  it("ignores Ctrl+Enter on a plain event", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Control>}{Enter}{/Control}");
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("ignores Ctrl+Enter in an empty slot", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{Control>}{Enter}{/Control}");
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
    expect(screen.queryByText("new event")).not.toBeInTheDocument();
  });

  it("names the focused event through aria-activedescendant", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}");

    expect(slot()).toHaveAccessibleName(
      "Planning, Wednesday 18 March, 9 to 10 AM",
    );
    expect(within(grid()).getByRole("button", { name: /^Planning/ })).toBe(
      slot(),
    );
  });
});

describe("Calendar grid keyboard: pointer users", () => {
  it("does not start keyboard focus when the grid is clicked", async () => {
    const { user } = renderCalendar({ mode: "week" });
    await screen.findByText("Wed 18");
    await user.click(grid());

    expect(grid()).toHaveFocus();
    expect(grid()).not.toHaveAttribute("aria-activedescendant");
    expect(document.querySelector('[id^="calendar-slot-"]')).toBeNull();
    expect(spoken()).toBe("");
  });

  it("keeps arrow keys changing the date after a click on the grid", async () => {
    const { user } = renderCalendar({ mode: "week" });
    await screen.findByText("Wed 18");
    await user.click(grid());
    await user.keyboard("{ArrowRight}");

    expect(await screen.findByText("Wed 25")).toBeInTheDocument();
    expect(document.querySelector('[id^="calendar-slot-"]')).toBeNull();
  });

  it("keeps Enter and Space inert after a click on the grid", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    await user.click(grid());
    await user.keyboard("{Enter}{ }");

    expect(screen.queryByText("new event")).not.toBeInTheDocument();
    expect(isSelected(await getEventBlock("Planning"))).toBe(false);
  });

  it("switches to pointer mode when the focused grid is clicked", async () => {
    const { user } = renderCalendar({ mode: "week" });
    await screen.findByText("Wed 18");
    focusGrid();
    await user.keyboard("{ArrowDown}");
    await user.click(grid());
    await user.keyboard("{ArrowRight}");

    expect(await screen.findByText("Wed 25")).toBeInTheDocument();
  });

  it("does not focus events or show a slot when an event is clicked", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await user.click(await getEventBlock("Planning"));

    expect(document.querySelector('[id^="calendar-slot-"]')).toBeNull();
    expect(grid()).not.toHaveAttribute("aria-activedescendant");
    const block = await getEventBlock("Planning");
    expect(block.className).not.toContain(
      "group-data-keyboard-mode/grid:outline-2",
    );
  });

  it("does not consume other window shortcuts in keyboard mode", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{Control>}z{/Control}");
    expect(screen.getByText("Planning")).toBeInTheDocument();
  });

  it("only reacts to keys typed on the grid itself", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    const box = document.createElement("input");
    grid().appendChild(box);
    act(() => box.focus());
    await user.keyboard("{ArrowDown}{Enter}");

    expect(document.querySelector('[id^="calendar-slot-"]')).toBeNull();
    expect(screen.queryByText("new event")).not.toBeInTheDocument();
  });
});

describe("Calendar grid keyboard: views", () => {
  it("keeps working after switching from week to day view", async () => {
    const ui = (mode: "day" | "week") => (
      <SettingsStoreProvider>
        <CalendarProvider>
          <AppCalendar
            events={[]}
            mode={mode}
            setMode={vi.fn()}
            saveEvents={vi.fn()}
            syncEvents={vi.fn()}
            syncBuckets={vi.fn()}
            saveDebounceMs={0}
          />
        </CalendarProvider>
      </SettingsStoreProvider>
    );
    const user = userEvent.setup();
    const { rerender } = render(ui("week"));
    await screen.findByText("Wed 18");
    focusGrid();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(spoken()).toContain("Saturday 21 March");

    rerender(ui("day"));
    await user.keyboard("{ArrowDown}");
    expect(spoken()).toBe("10:35 AM, Wednesday 18 March 2026, today");
    expect(
      getDayCell(0).querySelector('[id^="calendar-slot-"]'),
    ).not.toBeNull();
  });
});

describe("Calendar grid keyboard: input mode", () => {
  it("ignores keys once the grid has lost focus", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    act(() => grid().blur());
    fireEvent.keyDown(grid(), { key: "Enter" });

    expect(screen.queryByText("new event")).not.toBeInTheDocument();
  });

  it("ignores keys typed in a control inside the grid while the grid has keyboard focus", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    const box = document.createElement("input");
    grid().appendChild(box);
    fireEvent.keyDown(box, { key: "Enter" });

    expect(screen.queryByText("new event")).not.toBeInTheDocument();
  });

  it("returns to keyboard mode after a click on the focused grid is released", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    await user.click(grid());
    act(() => grid().blur());
    focusGrid();
    await user.keyboard("{ArrowDown}");

    expect(spoken()).toContain("10:35 AM");
  });

  it("does not let an unreleased pointer press leak into the next focus", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    fireEvent.pointerDown(grid());
    fireEvent.keyDown(grid(), { key: "ArrowDown" });
    act(() => grid().blur());
    focusGrid();
    await user.keyboard("{ArrowDown}");

    expect(spoken()).toContain("10:35 AM");
  });
});

describe("Calendar grid keyboard: more coverage", () => {
  const weekEvent = (title: string, dayIndex: number) =>
    buildEvent({
      id: title,
      title,
      start: today
        .startOf("week")
        .plus({ days: dayIndex, hours: 10, minutes: 30 }),
      end: today.startOf("week").plus({ days: dayIndex, hours: 11 }),
    });

  it("keeps Tab moving out of the grid from a slot, even with events in it", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Tab}");

    expect(grid()).not.toHaveFocus();
    expect(activeId()).toBeNull();
  });

  it("marks only the focused day's block of a multi-day event", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildEvent({
          id: "trip",
          title: "Trip",
          start: today.plus({ hours: 22 }),
          end: today.plus({ days: 1, hours: 2 }),
        }),
      ],
    });
    await screen.findAllByText("Trip");
    focusGrid();
    await user.keyboard("{End}{Enter}");

    const blocks = document.querySelectorAll('[data-event-key="trip"]');
    expect(blocks).toHaveLength(2);
    const focused = [...blocks].filter((b) =>
      b.className.includes("group-data-keyboard-mode/grid:outline-2"),
    );
    expect(focused).toHaveLength(1);
    expect(focused[0].id).toBe(activeId());
  });

  it("opens the editor for an event on a later day", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [weekEvent("Thursday thing", 3)],
    });
    await screen.findByText("Thursday thing");
    focusGrid();
    await user.keyboard("{ArrowRight}{Enter}{Enter}{Enter}");

    expect(
      await screen.findByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Thursday thing")).toBeInTheDocument();
  });

  it("creates the event on the focused day", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({ mode: "week", saveEvents });
    await screen.findByText("Wed 18");
    focusGrid();
    await user.keyboard("{ArrowRight}{Enter}");
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      today.plus({ days: 1, hours: 10, minutes: 30 }).toISO(),
    );
  });

  it("selects only the focused event when Shift+Arrow leaves the slot", async () => {
    const { user } = renderCalendar({ mode: "week", events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Shift>}{ArrowRight}{/Shift}");

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Overlap"))).toBe(false);
    expect(spoken()).toContain("1 selected");
  });

  it("does not select events of the next week when Shift+Arrow crosses into it", async () => {
    const nextWeek = buildEvent({
      id: "next-week",
      title: "Next week",
      start: today.plus({ days: 5, hours: 10, minutes: 30 }),
      end: today.plus({ days: 5, hours: 11, minutes: 30 }),
    });
    const { user } = renderCalendar({ mode: "week", events: [nextWeek] });
    await screen.findByText("Wed 18");
    focusGrid();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");

    expect(await screen.findByText("Mon 23")).toBeInTheDocument();
    expect(isSelected(await getEventBlock("Next week"))).toBe(false);
  });

  it("keeps earlier selections when extending with Shift+Arrow", async () => {
    const { user } = renderCalendar({ mode: "week", events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{ }{Tab}{Shift>}{ArrowRight}{/Shift}");

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Overlap"))).toBe(true);
    expect(spoken()).toContain("2 selected");
  });

  it("does not announce a selection when Shift+Arrow selects nothing", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");

    expect(spoken()).toBe("10:35 AM, Wednesday 18 March 2026, today");
  });

  it("deletes the selection rather than an unselected focused event", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Tab}{ }{Shift>}{Tab}{/Shift}{Delete}");

    expect(screen.queryByText("Overlap")).not.toBeInTheDocument();
    expect(screen.getByText("Planning")).toBeInTheDocument();
  });

  it("does nothing on Delete in an empty slot", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{Delete}");
    await advanceSave();

    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("hides the slot indicator while an event has focus", async () => {
    const { user } = renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();
    expect(document.querySelector('[id^="calendar-slot-"]')).not.toBeNull();
    await user.keyboard("{PageUp}{Enter}");

    expect(document.querySelector('[id^="calendar-slot-"]')).toBeNull();
  });

  it("sizes and places the slot indicator from snap and zoom", async () => {
    seedSettings({ snapMinutes: 30 });
    renderCalendar();
    await screen.findByText("Wed 18");
    act(() => {
      window.dispatchEvent(
        new WheelEvent("wheel", { ctrlKey: true, deltaY: -100, bubbles: true }),
      );
    });
    await waitFor(() =>
      expect(grid().style.gridTemplateRows).toContain("70px"),
    );
    focusGrid();

    // 10:30 at 70px per hour, one 30 minute slot
    expect(slot().style.top).toBe("735px");
    expect(slot().style.height).toBe("35px");
    expect(slot()).toHaveAttribute("tabindex", "-1");
  });
});

describe("Calendar grid keyboard: keyboard mode", () => {
  const inKeyboardMode = () => grid().hasAttribute("data-keyboard-mode");
  const nextDay = async () => {
    await screen.findByText("Wed 18");
    fireEvent.keyDown(grid(), { key: "ArrowRight" });
    return screen.findByText("Wed 25");
  };

  it("gives the indicator a minimum height at fine snap and default zoom", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();

    expect(slot().style.top).toBe("630px");
    expect(slot().style.height).toBe("20px");
  });

  it("keeps the minimum height at small zoom without moving the slot", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    for (let i = 0; i < 4; i++) {
      act(() => {
        window.dispatchEvent(
          new WheelEvent("wheel", {
            ctrlKey: true,
            deltaY: 100,
            bubbles: true,
          }),
        );
      });
    }
    await waitFor(() =>
      expect(grid().style.gridTemplateRows).toContain("20px"),
    );
    focusGrid();

    expect(slot().style.top).toBe("210px");
    expect(slot().style.height).toBe("20px");
  });

  it("shows the indicator and event outline from the keyboard mode attribute", async () => {
    renderCalendar({ events: overlapping() });
    await screen.findByText("Planning");
    focusGrid();

    expect(inKeyboardMode()).toBe(true);
    expect(slot().className).toContain(
      "group-data-keyboard-mode/grid:opacity-100",
    );
    expect(slot().className).toContain("border-2");
    expect(slot().className).toContain("bg-foreground/15");
  });

  it("enters keyboard mode when tabbing into the grid", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    for (let i = 0; i < 15 && document.activeElement !== grid(); i++)
      await user.tab();

    expect(grid()).toHaveFocus();
    expect(inKeyboardMode()).toBe(true);
    expect(spoken()).toBe("10:30 AM, Wednesday 18 March 2026, today");
  });

  it("leaves keyboard mode on a click on the keyboard-focused grid", async () => {
    const { user } = renderCalendar({ mode: "week" });
    await screen.findByText("Wed 18");
    focusGrid();
    await user.click(grid());

    expect(inKeyboardMode()).toBe(false);
    expect(await nextDay()).toBeInTheDocument();
  });

  it("leaves keyboard mode on a right-click on the keyboard-focused grid", async () => {
    const { user } = renderCalendar({ mode: "week" });
    await screen.findByText("Wed 18");
    focusGrid();
    await user.pointer({ target: grid(), keys: "[MouseRight]" });

    expect(inKeyboardMode()).toBe(false);
    expect(await nextDay()).toBeInTheDocument();
  });

  it("leaves keyboard mode on a touch press on an event inside the grid", async () => {
    renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    focusGrid();
    fireEvent.pointerDown(await getEventBlock("Planning"), {
      pointerType: "touch",
    });

    expect(inKeyboardMode()).toBe(false);
  });

  it("keeps keyboard mode for a press outside the grid", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    fireEvent.pointerDown(document.body);

    expect(inKeyboardMode()).toBe(true);
  });

  it("leaves keyboard mode when the grid loses focus", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    act(() => grid().blur());

    expect(inKeyboardMode()).toBe(false);
  });

  it("stays in pointer mode when a menu opened by right-click returns focus to the grid", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
    });
    await screen.findByText("Wed 18");
    focusGrid();
    await openEventMenu(user, "Planning");
    await screen.findByRole("menuitem", { name: /edit/i });
    await user.keyboard("{Escape}");
    act(() => grid().focus());

    expect(inKeyboardMode()).toBe(false);
    expect(await nextDay()).toBeInTheDocument();
    expect(document.querySelector('[id^="calendar-slot-"]')).not.toBeNull();
  });

  it("does not enter keyboard mode on script focus after a pointer press", async () => {
    renderCalendar({ mode: "week" });
    await screen.findByText("Wed 18");
    fireEvent.pointerDown(document.body);
    act(() => grid().focus());

    expect(inKeyboardMode()).toBe(false);
    expect(spoken()).toBe("");
    expect(await nextDay()).toBeInTheDocument();
  });

  it("re-enters keyboard mode when focus is restored after keyboard use", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    focusGrid();
    act(() => grid().blur());
    act(() => grid().focus());
    await user.keyboard("{ArrowDown}");

    expect(inKeyboardMode()).toBe(true);
    expect(spoken()).toContain("10:35 AM");
  });

  it("re-enters keyboard mode after a pointer press once Tab is used", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    fireEvent.pointerDown(document.body);
    await user.keyboard("{Tab}");
    act(() => grid().focus());

    expect(inKeyboardMode()).toBe(true);
  });

  it("does not treat other keys as a return to keyboard input", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document.body, { key: "Escape" });
    act(() => grid().focus());

    expect(inKeyboardMode()).toBe(false);
  });

  it("treats focus with no earlier input as keyboard focus", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    act(() => grid().focus());

    expect(inKeyboardMode()).toBe(true);
  });

  describe("with :focus-visible support", () => {
    const withFocusVisible = (matches: boolean) => {
      const original = Element.prototype.matches;
      vi.spyOn(Element.prototype, "matches").mockImplementation(function (
        this: Element,
        selector: string,
      ) {
        return selector === ":focus-visible"
          ? matches
          : original.call(this, selector);
      });
    };

    it("enters keyboard mode when the browser reports keyboard focus", async () => {
      renderCalendar();
      await screen.findByText("Wed 18");
      withFocusVisible(true);
      focusGrid();

      expect(inKeyboardMode()).toBe(true);
    });

    it("stays in pointer mode when the browser does not report keyboard focus", async () => {
      renderCalendar();
      await screen.findByText("Wed 18");
      withFocusVisible(false);
      focusGrid();

      expect(inKeyboardMode()).toBe(false);
      expect(spoken()).toBe("");
    });
  });
});
