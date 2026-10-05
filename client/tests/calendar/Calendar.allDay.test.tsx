import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import {
  advanceSave,
  buildEvent,
  buildPlainEvent,
  dayCenterX,
  FIXED_NOW,
  GRID_HEADER_HEIGHT,
  dispatchWindowPointer,
  getEventBlock,
  getLastSavedEvents,
  makeRect,
  openEventEditor,
  renderCalendar,
  setupCalendarTests,
  timeToClientY,
} from "./helpers";
import { applyLanguage } from "../../src/i18n";
import { seedSettings } from "../settingsStorage.ts";
import { focusGrid, grid, spoken } from "./gridKeyboardHelpers";
import {
  ALL_DAY_MIN_ROWS,
  ALL_DAY_ROW_HEIGHT,
} from "../../src/lib/calendar/eventBars.ts";

setupCalendarTests();

const TODAY = 2;
const STRIP_BOTTOM =
  GRID_HEADER_HEIGHT + ALL_DAY_MIN_ROWS * ALL_DAY_ROW_HEIGHT;

const allDay = (id: string, title: string, dayIndex: number) => {
  const start = FIXED_NOW.startOf("week").plus({ days: dayIndex });
  return buildEvent({
    id,
    title,
    start,
    end: start.endOf("day"),
    allDay: true,
  });
};

describe("all day strip", () => {
  it("expands when a dragged event lands behind the collapsed box", async () => {
    renderCalendar({
      mode: "week",
      events: [
        ...[1, 2, 3, 4, 5].map((n) => allDay(`a${n}`, `A${n}`, 1)),
        allDay("mover", "Mover", 3),
      ],
    });
    expect(screen.queryByLabelText("Collapse all-day events")).toBeNull();

    const block = await getEventBlock("Mover");
    fireEvent.pointerDown(block, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: dayCenterX(3),
      clientY: 60,
    });
    dispatchWindowPointer("pointermove", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: dayCenterX(1),
      clientY: 60,
    });

    expect(screen.getByLabelText("Collapse all-day events")).toBeTruthy();

    dispatchWindowPointer("pointermove", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: dayCenterX(5),
      clientY: 60,
    });

    expect(screen.getByLabelText("Expand all-day events")).toBeTruthy();
  });

  it("turns an event into all day from the editor", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Planning");
    await user.click(screen.getByLabelText("All day"));
    expect(screen.queryByDisplayValue("09:00")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await advanceSave();

    const [saved] = getLastSavedEvents(saveEvents);
    expect(saved.allDay).toBe(true);
    expect(saved.start.toISO()).toBe(FIXED_NOW.startOf("day").toISO());
    expect(saved.end.toISO()).toBe(FIXED_NOW.endOf("day").toISO());
  });

  it("makes a timed event all day when dragged into the strip", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      saveEvents,
      events: [buildPlainEvent(), allDay("holiday", "Holiday", 0)],
    });

    const block = await getEventBlock("Planning");
    fireEvent.pointerDown(block, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: dayCenterX(TODAY),
      clientY: timeToClientY(9, 30),
    });
    for (const type of ["pointermove", "pointerup"] as const) {
      dispatchWindowPointer(type, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: dayCenterX(TODAY),
        clientY: 60,
      });
    }
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents).find(
      (e) => e.title === "Planning",
    )!;
    expect(saved.allDay).toBe(true);
    expect(saved.start.toISO()).toBe(FIXED_NOW.startOf("day").toISO());
    expect(saved.end.toISO()).toBe(FIXED_NOW.endOf("day").toISO());
  });

  it("makes an all day event timed when dragged into the grid", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      saveEvents,
      events: [allDay("holiday", "Holiday", TODAY)],
    });

    const block = await getEventBlock("Holiday");
    fireEvent.pointerDown(block, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: dayCenterX(TODAY),
      clientY: 60,
    });
    for (const type of ["pointermove", "pointerup"] as const) {
      dispatchWindowPointer(type, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: dayCenterX(TODAY + 1),
        clientY: STRIP_BOTTOM + 14 * 60,
      });
    }
    await advanceSave();

    const [saved] = getLastSavedEvents(saveEvents);
    expect(saved.allDay).toBeFalsy();
    expect(saved.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 14 }).toISO(),
    );
    expect(saved.end.diff(saved.start, "minutes").minutes).toBe(60);
  });

  it("resizes an all day event by whole days", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      saveEvents,
      events: [allDay("holiday", "Holiday", 1)],
    });

    const block = await getEventBlock("Holiday");
    const handle = block.querySelector(".cursor-ew-resize.right-0")!;
    fireEvent.pointerDown(handle, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: dayCenterX(1),
      clientY: 60,
    });
    for (const type of ["pointermove", "pointerup"] as const) {
      dispatchWindowPointer(type, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: dayCenterX(3),
        clientY: 60,
      });
    }
    await advanceSave();

    const [saved] = getLastSavedEvents(saveEvents);
    expect(saved.start.toISODate()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 1 }).toISODate(),
    );
    expect(saved.end.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 3 }).endOf("day").toISO(),
    );
  });

  it("creates an all day event from the bottom half of a header", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", saveEvents });

    const header = screen.getAllByRole("columnheader")[1];
    vi.spyOn(header, "getBoundingClientRect").mockReturnValue(
      makeRect(0, 0, 100, 48),
    );
    fireEvent.click(header, { clientY: 10 });
    await advanceSave();
    expect(saveEvents).not.toHaveBeenCalled();

    fireEvent.click(header, { clientY: 40 });
    await advanceSave();

    const [saved] = getLastSavedEvents(saveEvents);
    expect(saved.allDay).toBe(true);
    expect(saved.start.toISODate()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 1 }).toISODate(),
    );
  });

  it("creates a multi-day all day event by dragging across the strip", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      saveEvents,
      events: [allDay("holiday", "Holiday", 6)],
    });
    await screen.findByText("Holiday");

    const cell = screen
      .getAllByRole("gridcell")
      .find((el) => el.className.includes("sticky"))!;
    fireEvent.pointerDown(cell, { button: 0, clientX: dayCenterX(0) });
    dispatchWindowPointer("pointermove", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: dayCenterX(2),
      clientY: 60,
    });
    dispatchWindowPointer("pointerup", {
      pointerId: 1,
      pointerType: "mouse",
      clientX: dayCenterX(2),
      clientY: 60,
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents).find((e) => e.id !== "holiday")!;
    expect(saved.allDay).toBe(true);
    expect(saved.end.toISODate()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 2 }).toISODate(),
    );
  });

  it("enters and leaves the strip with the keyboard", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), allDay("holiday", "Holiday", 0)],
    });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}m");
    await user.keyboard("{PageUp>9/}");
    await user.keyboard("{ArrowUp}");

    expect(spoken()).toBe("Wednesday 18 March, All day");

    await user.keyboard("{ArrowUp}");

    expect(spoken()).toBe("Wednesday 18 March, All day");

    await user.keyboard("{ArrowDown}");

    expect(spoken()).toBe("Wednesday 18 March, 12 to 1 AM");
  });

  it("keeps a multi-day all day event's length when dragged", async () => {
    const saveEvents = vi.fn();
    const first = allDay("trip", "Trip", 0);
    renderCalendar({
      mode: "week",
      saveEvents,
      events: [{ ...first, end: first.end.plus({ days: 1 }) }],
    });

    const [block] = await screen.findAllByText("Trip");
    fireEvent.pointerDown(block.closest(".event-block")!, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: dayCenterX(0),
      clientY: 60,
    });
    for (const type of ["pointermove", "pointerup"] as const) {
      dispatchWindowPointer(type, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: dayCenterX(2),
        clientY: 60,
      });
    }
    await advanceSave();

    const [saved] = getLastSavedEvents(saveEvents);
    expect(saved.start.toISODate()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 2 }).toISODate(),
    );
    expect(saved.end.toISODate()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 3 }).toISODate(),
    );
  });

  it("saves a drag into the strip that only flips all day", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      saveEvents,
      events: [
        buildEvent({
          start: FIXED_NOW.startOf("day"),
          end: FIXED_NOW.endOf("day"),
        }),
        allDay("holiday", "Holiday", 0),
      ],
    });

    const block = await getEventBlock("Planning");
    fireEvent.pointerDown(block, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: dayCenterX(TODAY),
      clientY: timeToClientY(12),
    });
    for (const type of ["pointermove", "pointerup"] as const) {
      dispatchWindowPointer(type, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: dayCenterX(TODAY),
        clientY: 60,
      });
    }
    await advanceSave();

    expect(
      getLastSavedEvents(saveEvents).find((e) => e.title === "Planning")!
        .allDay,
    ).toBe(true);
  });

  it("shows no time or repeat marker on all day bars", async () => {
    const first = allDay("trip", "Trip", 0);
    renderCalendar({
      mode: "week",
      events: [{ ...first, end: first.end.plus({ days: 1 }) }],
    });

    const blocks = (await screen.findAllByText("Trip")).map(
      (el) => el.closest(".event-block")!,
    );
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.textContent).not.toMatch(/\d|AM|PM/);
    }
    expect(
      document.querySelectorAll(".event-block svg").length,
    ).toBe(0);
  });
});

const spanning = (title: string, from: number, days: number) => {
  const first = allDay("trip", title, from);
  return { ...first, end: first.end.plus({ days: days - 1 }) };
};

describe("all day title across the bar", () => {
  afterEach(() => applyLanguage("en"));

  const titleBox = () => screen.getByText("Trip").parentElement!;

  it("draws the title once, as wide as the visible bar, and raises its cell", () => {
    renderCalendar({ mode: "week", events: [spanning("Trip", 1, 3)] });

    expect(screen.getAllByText("Trip")).toHaveLength(1);
    expect(titleBox().style.width).toBe(
      "calc(300% + 1rem)",
    );
    expect(titleBox().style.marginLeft).toBe("");
    expect(titleBox().className).toContain("pointer-events-none");
    expect(titleBox().closest<HTMLElement>(".event-block")!.style.contain).toBe(
      "",
    );
    expect(titleBox().closest("[role=gridcell]")!.className).toContain("z-17");
  });

  it("puts the title on the first visible day of a bar that started earlier", () => {
    const first = allDay("trip", "Trip", 0);
    renderCalendar({
      mode: "week",
      events: [
        {
          ...first,
          start: first.start.minus({ days: 3 }),
          end: first.end.plus({ days: 1 }),
        },
      ],
    });

    expect(titleBox().style.width).toBe(
      "calc(200% + 0.5rem)",
    );
    expect(titleBox().closest(".event-block")!.getAttribute("style")).toContain(
      "overflow: visible",
    );
  });

  it("truncates a long title on one line instead of wrapping", () => {
    renderCalendar({
      mode: "week",
      events: [spanning("Trip with a very long title indeed", 1, 2)],
    });

    const title = screen.getByText("Trip with a very long title indeed");
    expect(title.className).toContain("truncate");
    expect(title.style.display).toBe("");
  });

  it("leaves one-day events unstretched", () => {
    renderCalendar({ mode: "week", events: [spanning("Trip", 1, 1)] });

    expect(titleBox().style.width).toBe("");
    expect(titleBox().className).not.toContain("pointer-events-none");
    expect(titleBox().closest<HTMLElement>(".event-block")!.style.contain).toBe(
      "paint",
    );
    expect(titleBox().closest("[role=gridcell]")!.className).not.toContain(
      "z-17",
    );
  });

  it("extends towards the later days in right-to-left", () => {
    applyLanguage("ar");
    renderCalendar({ mode: "week", events: [spanning("Trip", 1, 3)] });

    expect(titleBox().style.marginLeft).toBe(
      "calc(-200% - 1rem)",
    );
    expect(titleBox().getAttribute("dir")).toBe("rtl");
  });
});

describe("all day label alignment", () => {
  const label = () => screen.getByRole("rowheader", { name: "All day" });
  const events = [allDay("holiday", "Holiday", 0)];
  const timezones = ["UTC", "Asia/Tokyo"];

  it("has one row header per time zone, like the hour rows", () => {
    seedSettings({ timezones });
    renderCalendar({ mode: "week", events });

    const row = label().closest("[role=row]")!;
    expect(row.querySelectorAll("[role=rowheader]")).toHaveLength(2);
    expect(row.querySelectorAll("[role=gridcell]")).toHaveLength(7);
  });

  it("hides the divider between the time zone cells next to the label", () => {
    seedSettings({ timezones });
    renderCalendar({ mode: "week", events });

    const [first, last] = label()
      .closest("[role=row]")!
      .querySelectorAll("[role=rowheader]");
    expect(first.className).toContain("shadow-[inset_0_-1px_0_0");
    expect(last.className).not.toContain("shadow-[inset_0_-1px_0_0");
  });

  it("centers with one time zone", () => {
    renderCalendar({ mode: "week", events });

    expect(label().className).toContain("justify-center");
  });

  it("aligns towards the grid when time labels are on the left", () => {
    seedSettings({ timezones, timeLabelPosition: "left" });
    renderCalendar({ mode: "week", events });

    expect(label().className).toContain("justify-end");
  });

  it("aligns left when time labels are on the right", () => {
    seedSettings({ timezones, timeLabelPosition: "right" });
    renderCalendar({ mode: "week", events });

    expect(label().className).toContain("justify-start");
    expect(label().className).not.toContain("justify-end");
  });
});

describe("all day strip keyboard expand", () => {
  const crowded = [1, 2, 3, 4, 5].map((n) => allDay(`a${n}`, `A${n}`, 2));
  const expand = () => screen.queryByLabelText("Expand all-day events");
  const collapse = () => screen.queryByLabelText("Collapse all-day events");

  it("opens on Enter over a collapsed day and closes when leaving it", async () => {
    const { user } = renderCalendar({ mode: "week", events: crowded });
    await screen.findByText("A1");
    focusGrid();
    await user.keyboard("{Home}{ArrowUp}");
    expect(expand()).toBeTruthy();

    await user.keyboard("{Enter}");
    expect(collapse()).toBeTruthy();

    await user.keyboard("{ArrowRight}");
    expect(expand()).toBeTruthy();
    expect(collapse()).toBeNull();
  });

  it("stays closed for timed events and days without hidden events", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [...crowded, allDay("solo", "Solo", 3), buildPlainEvent()],
    });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}");
    expect(expand()).toBeTruthy();

    await user.keyboard("{Escape}{Home}{ArrowUp}{ArrowRight}{Enter}");
    expect(expand()).toBeTruthy();
  });

  it("opens the editor for a hidden event without looping", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [...crowded, allDay("a6", "A6", 2)],
    });
    await screen.findByText("A1");
    focusGrid();
    await user.keyboard("{Home}{ArrowUp}{Enter}{Tab}{Tab}{Tab}{Tab}{Tab}");
    expect(spoken()).toContain("A6");

    await user.keyboard("{Enter}{Enter}");
    expect(
      await screen.findByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();
    expect(collapse()).toBeTruthy();
    expect(screen.getByText("A6")).toBeInTheDocument();
  });

  it("keeps a strip that was opened by hand", async () => {
    const { user } = renderCalendar({ mode: "week", events: crowded });
    await user.click(await screen.findByLabelText("Expand all-day events"));
    focusGrid();
    await user.keyboard("{Home}{ArrowUp}{Enter}{ArrowRight}");

    expect(collapse()).toBeTruthy();
  });

  it("closes when the grid loses focus", async () => {
    const { user } = renderCalendar({ mode: "week", events: crowded });
    await screen.findByText("A1");
    focusGrid();
    await user.keyboard("{Home}{ArrowUp}{Enter}");
    expect(collapse()).toBeTruthy();

    act(() => grid().blur());
    expect(expand()).toBeTruthy();
  });
});
