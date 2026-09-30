import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  FIXED_NOW,
  advanceSave,
  buildEvent,
  buildPlainEvent,
  buildRecurringEvent,
  buildSecondEvent,
  dayCenterX,
  dragEvent,
  getDayCell,
  getEventBlock,
  getLastSavedEvents,
  isSelected,
  renderCalendar,
  setupCalendarTests,
  timeToClientY,
} from "./helpers";
import { activeElement, focusGrid, grid, spoken } from "./gridKeyboardHelpers";
import { seedSettings } from "../settingsStorage.ts";

setupCalendarTests();

const day = FIXED_NOW.startOf("day");

type User = ReturnType<typeof userEvent.setup>;

// Planning runs 9:00-10:00; one hour up from the 10:30 start lands on it
const focusPlanning = async (user: User) => {
  await screen.findByText("Planning");
  focusGrid();
  await user.keyboard("{PageUp}{Enter}");
};

const pickUp = async (user: User) => {
  await focusPlanning(user);
  await user.keyboard("m");
};

const top = async (title: string) => (await getEventBlock(title)).style.top;

describe("keyboard move: picking up", () => {
  it("announces the controls and advertises the shortcut", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);

    expect(spoken()).toBe(
      "Moving Planning. Arrow keys move, Shift plus arrow keys resize, Enter to confirm, Escape to cancel.",
    );
    expect(
      (await getEventBlock("Planning")).getAttribute("aria-keyshortcuts"),
    ).toBe("M");
  });

  it("lists the shortcut on tasks next to completion", async () => {
    renderCalendar({
      events: [buildEvent({ id: "task", title: "Pay rent", isTask: true })],
    });

    expect(screen.getByRole("group", { name: /^Pay rent/ })).toHaveAttribute(
      "aria-keyshortcuts",
      "M Control+Enter",
    );
  });

  it("does nothing on an empty slot", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    focusGrid();
    const before = spoken();
    await user.keyboard("m");

    expect(spoken()).toBe(before);
  });

  it("ignores M with Ctrl", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await focusPlanning(user);
    await user.keyboard("{Control>}m{/Control}");
    await user.keyboard("{ArrowDown}");

    expect(spoken()).toContain("9:35 AM");
    expect(await top("Planning")).toBe("540px");
  });
});

describe("keyboard move: moving", () => {
  it("steps by snapMinutes and shows the preview before confirming", async () => {
    seedSettings({ snapMinutes: 15 });
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await pickUp(user);
    await user.keyboard("{ArrowDown}");

    expect(spoken()).toBe("Wednesday 18 March, 9:15 to 10:15 AM");
    expect(await top("Planning")).toBe("555px");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(spoken()).toBe("Wednesday 18 March, 8:45 to 9:45 AM");
    await advanceSave();
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("moves an hour with PageUp and PageDown", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    await user.keyboard("{PageDown}{PageDown}");

    expect(spoken()).toBe("Wednesday 18 March, 11 AM to 12 PM");
    await user.keyboard("{PageUp}");
    expect(spoken()).toBe("Wednesday 18 March, 10 to 11 AM");
  });

  it("moves between days in week view", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
    });
    await pickUp(user);
    await user.keyboard("{ArrowRight}{ArrowRight}");

    expect(spoken()).toBe("Friday 20 March, 9 to 10 AM");
    const moved = await getEventBlock("Planning");
    expect(getDayCell(4).contains(moved)).toBe(true);
    await user.keyboard("{ArrowLeft}");
    expect(spoken()).toBe("Thursday 19 March, 9 to 10 AM");
  });

  it("crosses into the next and previous week at the edges", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
    });
    await pickUp(user);
    await user.keyboard(
      "{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}",
    );

    expect(spoken()).toBe("Monday 23 March, 9 to 10 AM");
    expect(await screen.findByText("Mon 23")).toBeInTheDocument();
    expect(getDayCell(0).contains(await getEventBlock("Planning"))).toBe(true);

    await user.keyboard("{ArrowLeft}");
    expect(spoken()).toBe("Sunday 22 March, 9 to 10 AM");
    expect(await screen.findByText("Sun 22")).toBeInTheDocument();
  });

  it("moves to the adjacent day in day view, changing the date", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    await user.keyboard("{ArrowRight}");

    expect(spoken()).toBe("Thursday 19 March, 9 to 10 AM");
    expect(screen.getByText("Thu 19")).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(spoken()).toBe("Wednesday 18 March, 9 to 10 AM");
    expect(screen.getByText("Wed 18")).toBeInTheDocument();
    expect(await top("Planning")).toBe("540px");
  });

  it("keeps focus on the moved event", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
    });
    await pickUp(user);
    await user.keyboard("{ArrowRight}{ArrowDown}");

    const moved = await getEventBlock("Planning");
    expect(getDayCell(3).contains(moved)).toBe(true);
    expect(getDayCell(3).contains(activeElement())).toBe(true);
    expect(grid()).toHaveAttribute("data-keyboard-mode");

    await user.keyboard("{Enter}");
    expect(activeElement()).toHaveAccessibleName(
      "Moved Planning to Thursday 19 March, 9:05 to 10:05 AM",
    );
  });
});

describe("keyboard move: screen reader focus", () => {
  it("names the move on pick up through the active descendant", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);

    expect(activeElement()).toHaveAccessibleName(
      "Moving Planning. Arrow keys move, Shift plus arrow keys resize, Enter to confirm, Escape to cancel.",
    );
  });

  it("gets a new element with the new time on every step", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    const seen = [activeElement()!];

    for (const key of [
      "{ArrowDown}",
      "{ArrowDown}",
      "{Shift>}{ArrowUp}{/Shift}",
    ]) {
      await user.keyboard(key);
      seen.push(activeElement()!);
    }

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.slice(1).map((el) => el.getAttribute("aria-label"))).toEqual([
      "Wednesday 18 March, 9:05 to 10:05 AM",
      "Wednesday 18 March, 9:10 to 10:10 AM",
      "Wednesday 18 March, 9:10 to 10:05 AM",
    ]);
  });

  it("speaks the outcome through the active descendant on every way out", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await focusPlanning(user);

    await user.keyboard("m{ArrowDown}{Enter}");
    expect(activeElement()).toHaveAccessibleName(
      "Moved Planning to Wednesday 18 March, 9:05 to 10:05 AM",
    );
    await user.keyboard("m{ArrowDown}{Escape}");
    expect(activeElement()).toHaveAccessibleName("Move cancelled");
    await user.keyboard("m{Enter}");
    expect(activeElement()).toHaveAccessibleName("Move cancelled");

    await user.keyboard("m");
    act(() => grid().blur());
    expect(document.querySelector('[id^="calendar-spoken-"]')).toBeNull();
  });

  it("hands the active descendant back to the event with the next key", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await focusPlanning(user);
    const block = await getEventBlock("Planning");
    await user.keyboard("m{Escape}");
    expect(activeElement()).not.toBe(block);

    await user.keyboard("{Control>}{ArrowUp}{/Control}");
    expect(document.querySelector('[id^="calendar-spoken-"]')).not.toBeNull();
    await user.keyboard("{ArrowDown}");
    expect(document.querySelector('[id^="calendar-spoken-"]')).toBeNull();
  });
});

describe("keyboard move: info box", () => {
  const infoBox = (times: RegExp) => screen.getByText(times);

  it("shows the times and duration when the event is picked up", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await focusPlanning(user);
    expect(screen.queryByText(/9:00 AM - 10:00 AM/)).toBeNull();

    await user.keyboard("m");

    expect(infoBox(/9:00 AM - 10:00 AM/)).toHaveTextContent("1 hr");
    expect(infoBox(/9:00 AM - 10:00 AM/)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("follows moving and resizing", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);

    await user.keyboard("{ArrowDown}");
    expect(infoBox(/9:05 AM - 10:05 AM/)).toBeInTheDocument();

    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(infoBox(/9:05 AM - 10:10 AM/)).toHaveTextContent("1 hr 5 min");
  });

  it("has no edge arrows for changing the week", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);

    expect(document.querySelector("[data-steps]")).toBeNull();
  });

  it("goes away on confirm and on cancel", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.queryByText(/9:05 AM - 10:05 AM/)).toBeNull();

    await user.keyboard("m{ArrowDown}");
    expect(infoBox(/9:10 AM - 10:10 AM/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText(/AM - .* AM/)).toBeNull();
  });

  it("sits above the event block and follows it", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const block = this instanceof HTMLElement && this.dataset.eventKey;
        const top = block
          ? 100 + parseFloat((this as HTMLElement).style.top)
          : 0;
        return {
          top,
          bottom: top + 60,
          left: 100,
          right: 300,
          width: 200,
          height: block ? 60 : 0,
          x: 100,
          y: top,
          toJSON: () => ({}),
        };
      },
    );
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);

    const box = () => infoBox(/9:\d\d AM - 10:\d\d AM/);
    expect(box().style.top).toBe("632px");
    expect(box().style.left).toBe("200px");

    await user.keyboard("{ArrowDown}");
    expect(box().style.top).toBe("637px");
  });

  it("goes below the block when there is no room above", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const block = this instanceof HTMLElement && this.dataset.eventKey;
        return {
          top: block ? 4 : 0,
          bottom: block ? 64 : 0,
          left: 100,
          right: 300,
          width: 200,
          height: block ? 60 : 0,
          x: 100,
          y: 4,
          toJSON: () => ({}),
        };
      },
    );
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);

    expect(infoBox(/9:00 AM - 10:00 AM/).style.top).toBe("72px");
  });
});

describe("keyboard move: resizing", () => {
  it("resizes the end with Shift+Up/Down", async () => {
    seedSettings({ snapMinutes: 15 });
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    await user.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");

    expect(spoken()).toBe("Wednesday 18 March, 9 to 10:30 AM");
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(spoken()).toBe("Wednesday 18 March, 9 to 10:15 AM");
  });

  it("resizes the start with Ctrl+Shift+Up/Down", async () => {
    seedSettings({ snapMinutes: 15 });
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    await user.keyboard(
      "{Control>}{Shift>}{ArrowUp}{ArrowUp}{/Shift}{/Control}",
    );

    expect(spoken()).toBe("Wednesday 18 March, 8:30 to 10 AM");
    await user.keyboard("{Control>}{Shift>}{ArrowDown}{/Shift}{/Control}");
    expect(spoken()).toBe("Wednesday 18 March, 8:45 to 10 AM");
  });

  it("keeps a minimum duration of one snap when shrinking the end", async () => {
    seedSettings({ snapMinutes: 15 });
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    await user.keyboard(
      "{Shift>}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{/Shift}",
    );

    expect(spoken()).toBe("Wednesday 18 March, 9 to 9:15 AM");
  });

  it("keeps a minimum duration of one snap when shrinking the start", async () => {
    seedSettings({ snapMinutes: 15 });
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    await user.keyboard(
      "{Control>}{Shift>}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{/Shift}{/Control}",
    );

    expect(spoken()).toBe("Wednesday 18 March, 9:45 to 10 AM");
  });

  it("combines a move and a resize", async () => {
    seedSettings({ snapMinutes: 15 });
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await pickUp(user);
    await user.keyboard("{PageDown}{Shift>}{ArrowDown}{/Shift}{Enter}");
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    expect(saved.start.toISO()).toBe(day.plus({ hours: 10 }).toISO());
    expect(saved.end.toISO()).toBe(
      day.plus({ hours: 11, minutes: 15 }).toISO(),
    );
  });

  it("resizes a lone selected event", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });
    await focusPlanning(user);
    await user.keyboard("{ }m{Shift>}{ArrowDown}{/Shift}{Enter}");
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].end.toISO()).toBe(
      day.plus({ hours: 10, minutes: 5 }).toISO(),
    );
  });
});

describe("keyboard move: confirming", () => {
  it("saves once, announces, and keeps focus and keyboard mode", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });
    await pickUp(user);
    await user.keyboard("{ArrowRight}{PageDown}{Enter}");
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    expect(saved.start.toISO()).toBe(day.plus({ days: 1, hours: 10 }).toISO());
    expect(saved.end.toISO()).toBe(day.plus({ days: 1, hours: 11 }).toISO());
    expect(spoken()).toBe("Moved Planning to Thursday 19 March, 10 to 11 AM");
    const moved = await getEventBlock("Planning");
    expect(grid()).toHaveFocus();
    expect(grid()).toHaveAttribute("data-keyboard-mode");
    expect(activeElement()).toHaveAccessibleName(
      "Moved Planning to Thursday 19 March, 10 to 11 AM",
    );
    expect(moved.className).toContain(
      "group-data-[keyboard-mode]/grid:outline-2",
    );
  });

  it("is undone with a single undo", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });
    await pickUp(user);
    await user.keyboard(
      "{ArrowRight}{PageDown}{Shift>}{ArrowDown}{/Shift}{Enter}",
    );
    await advanceSave();
    await user.keyboard("{Control>}z{/Control}");
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    expect(saved.start.toISO()).toBe(day.plus({ hours: 9 }).toISO());
    expect(saved.end.toISO()).toBe(day.plus({ hours: 10 }).toISO());
  });

  it("does not save or announce a move when nothing changed", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await pickUp(user);
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
    expect(spoken()).toBe("Move cancelled");
    expect(await top("Planning")).toBe("540px");
    expect(grid()).toHaveAttribute("data-keyboard-mode");
  });

  it("matches a pointer drop with the same offsets", async () => {
    seedSettings({ snapMinutes: 15 });
    const keyboardSave = vi.fn();
    const { user, unmount } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents: keyboardSave,
    });
    await pickUp(user);
    await user.keyboard("{ArrowRight}{ArrowDown}{ArrowDown}{Enter}");
    await advanceSave();
    const keyboardEvent = getLastSavedEvents(keyboardSave)[0];
    unmount();

    const pointerSave = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents: pointerSave,
    });
    await dragEvent({
      title: "Planning",
      startX: dayCenterX(2),
      startY: timeToClientY(9),
      endX: dayCenterX(3),
      endY: timeToClientY(9, 30),
    });
    await advanceSave();
    const pointerEvent = getLastSavedEvents(pointerSave)[0];

    const strip = ({ timestamp, ...rest }: Record<string, unknown>) => {
      void timestamp;
      return rest;
    };
    expect(strip(keyboardEvent)).toEqual(strip(pointerEvent));
  });

  it("keeps a task's completion state", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      saveEvents,
      events: [
        buildEvent({
          id: "task",
          title: "Pay rent",
          isTask: true,
          completed: true,
        }),
      ],
    });
    await screen.findByText("Pay rent");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}m{ArrowDown}{Enter}");
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0]).toMatchObject({
      isTask: true,
      completed: true,
    });
  });

  it("moves a multi-day event as a whole", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      saveEvents,
      events: [
        buildEvent({
          id: "trip",
          title: "Trip",
          start: day.plus({ hours: 22 }),
          end: day.plus({ days: 1, hours: 2 }),
        }),
      ],
    });
    await screen.findAllByText("Trip");
    focusGrid();
    await user.keyboard("{End}{Enter}m{ArrowUp}{Enter}");
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents)[0];
    expect(saved.start.toISO()).toBe(
      day.plus({ hours: 21, minutes: 55 }).toISO(),
    );
    expect(saved.end.toISO()).toBe(
      day.plus({ days: 1, hours: 1, minutes: 55 }).toISO(),
    );
  });
});

describe("keyboard move: cancelling", () => {
  it("restores the exact original position on Escape", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
      saveEvents,
    });
    await pickUp(user);
    await user.keyboard(
      "{ArrowRight}{ArrowRight}{PageDown}{Shift>}{ArrowDown}{/Shift}",
    );
    await user.keyboard("{Escape}");
    await advanceSave();

    const block = await getEventBlock("Planning");
    expect(getDayCell(2).contains(block)).toBe(true);
    expect(block.style.top).toBe("540px");
    expect(block.style.height).toBe("60px");
    expect(saveEvents).not.toHaveBeenCalled();
    expect(spoken()).toBe("Move cancelled");
    expect(activeElement()).toHaveAccessibleName("Move cancelled");
    expect(grid()).toHaveAttribute("data-keyboard-mode");
  });

  it("adds no history entry", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await pickUp(user);
    await user.keyboard("{ArrowDown}{Escape}");
    await user.keyboard("{Control>}z{/Control}");
    await advanceSave();

    expect(await top("Planning")).toBe("540px");
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("cancels on Tab and leaves the grid", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    await user.keyboard("{ArrowDown}{Tab}");

    expect(await top("Planning")).toBe("540px");
    expect(grid()).not.toHaveFocus();
  });

  it("cancels when the grid loses focus", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    await user.keyboard("{ArrowDown}");
    act(() => grid().blur());

    expect(await top("Planning")).toBe("540px");
    await user.keyboard("{ArrowDown}");
    expect(await top("Planning")).toBe("540px");
  });

  it("cancels on a pointer press anywhere", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    await user.keyboard("{ArrowDown}");
    fireEvent.pointerDown(document.body);

    expect(await top("Planning")).toBe("540px");
  });

  it("restores the original day after moving across days", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
    });
    await pickUp(user);
    await user.keyboard("{ArrowRight}{ArrowRight}{Escape}");
    await user.keyboard("{ArrowDown}");

    // back in slot navigation on the original day
    expect(spoken()).toContain("Wednesday 18 March");
  });
});

describe("keyboard move: exclusive keys", () => {
  it("ignores other keys and keeps the page and shortcuts out of it", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await pickUp(user);
    await user.keyboard("{ArrowDown}");
    await user.keyboard("x{ }{Home}{End}{Delete}");
    await user.keyboard("{Control>}z{/Control}{Control>}c{/Control}");
    await advanceSave();

    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(spoken()).toBe("Wednesday 18 March, 9:05 to 10:05 AM");
    expect(await top("Planning")).toBe("545px");
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("prevents scrolling keys", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    const notPrevented = ["Home", "End", " ", "x"].filter((key) => {
      const allowed = fireEvent.keyDown(grid(), { key });
      return allowed;
    });

    expect(notPrevented).toEqual([]);
  });

  it("leaves browser shortcuts with Ctrl alone", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);

    expect(fireEvent.keyDown(grid(), { key: "r", ctrlKey: true })).toBe(true);
  });
});

describe("keyboard move: selections", () => {
  const twoSelected = async (user: User) => {
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{ }");
    await user.keyboard("{PageDown}".repeat(4));
    await user.keyboard("{Enter}{ }");
  };

  it("moves every selected event together with one history entry", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });
    await twoSelected(user);
    await user.keyboard("m{ArrowRight}{PageDown}{Enter}");
    await advanceSave();

    expect(spoken()).toBe("Moved 2 events");
    let saved = getLastSavedEvents(saveEvents);
    expect(saved.find((e) => e.id === "plain-event")!.start.toISO()).toBe(
      day.plus({ days: 1, hours: 10 }).toISO(),
    );
    expect(saved.find((e) => e.id === "second-event")!.start.toISO()).toBe(
      day.plus({ days: 1, hours: 14 }).toISO(),
    );

    await user.keyboard("{Control>}z{/Control}");
    await advanceSave();
    saved = getLastSavedEvents(saveEvents);
    expect(saved.find((e) => e.id === "plain-event")!.start.toISO()).toBe(
      day.plus({ hours: 9 }).toISO(),
    );
    expect(saved.find((e) => e.id === "second-event")!.start.toISO()).toBe(
      day.plus({ hours: 13 }).toISO(),
    );
  });

  it("moves only the picked up event when it is not part of the selection", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{ }");
    await user.keyboard("{PageDown}".repeat(4));
    await user.keyboard("{Enter}m{ArrowRight}{Enter}");
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved.find((e) => e.id === "plain-event")!.start.toISO()).toBe(
      day.plus({ hours: 9 }).toISO(),
    );
    expect(saved.find((e) => e.id === "second-event")!.start.toISO()).toBe(
      day.plus({ days: 1, hours: 13 }).toISO(),
    );
  });

  it("says how many events go along when several are selected", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });
    await twoSelected(user);
    await user.keyboard("m");

    expect(spoken()).toContain("Moving Retro and 1 more.");
  });

  it("cancelling restores every selected event", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });
    await twoSelected(user);
    await user.keyboard("m{ArrowRight}{PageDown}{Escape}");

    expect(getDayCell(2).contains(await getEventBlock("Planning"))).toBe(true);
    expect(getDayCell(2).contains(await getEventBlock("Retro"))).toBe(true);
  });
});

describe("keyboard move: recurring events", () => {
  const openRecurring = async (user: User) => {
    await screen.findAllByText("Daily standup");
    focusGrid();
    // 8:00 standup; two hours up from the start slot
    await user.keyboard("{PageUp}{PageUp}{Enter}m{PageDown}{ArrowDown}{Enter}");
    return screen.findByText(/update recurring event/i);
  };

  it("asks what to update, like a pointer drop", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });
    await openRecurring(user);
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
    await user.click(screen.getByRole("radio", { name: /all events/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(saved[0].start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 2, hours: 9, minutes: 5 }).toISO(),
    );
  });

  it("hides the info box while the dialog is open", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
    });
    await openRecurring(user);

    expect(screen.queryByText(/9:05 AM - 10:05 AM/)).toBeNull();
  });

  it("detaches the occurrence for 'this event'", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });
    await openRecurring(user);
    await user.click(screen.getByRole("radio", { name: /this event/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(2);
    expect(saved.find((e) => e.id !== "repeat-parent")!.repeat).toBeUndefined();
  });

  it("restores the original position when the dialog is cancelled", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });
    await openRecurring(user);
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
    const blocks = screen
      .getAllByText("Daily standup")
      .map((n) => n.closest(".event-block") as HTMLElement);
    expect(blocks.some((b) => b.style.top === "480px")).toBe(true);
    expect(blocks.every((b) => b.style.top === "480px")).toBe(true);
  });

  it("hands focus back to the grid when the dialog closes", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
    });
    await openRecurring(user);
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(grid()).toHaveFocus());
  });
});

describe("keyboard move: keys and edge cases", () => {
  const twoSelected = async (user: User) => {
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{ }");
    await user.keyboard("{PageDown}".repeat(4));
    await user.keyboard("{Enter}{ }");
  };

  it("keeps the selection when Escape cancels a move", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });
    await twoSelected(user);
    await user.keyboard("m{ArrowRight}{Escape}");

    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
    expect(isSelected(await getEventBlock("Retro"))).toBe(true);
  });

  it("does not confirm on Ctrl+Enter", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await pickUp(user);
    await user.keyboard("{ArrowDown}{Control>}{Enter}{/Control}");
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
    expect(spoken()).toBe("Wednesday 18 March, 9:05 to 10:05 AM");
    await user.keyboard("{Enter}");
    await advanceSave();
    expect(saveEvents).toHaveBeenCalled();
  });

  it("returns to the slot it was picked up from when nothing changed", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}{ArrowDown}");

    expect(spoken()).toContain("9:35 AM");
  });

  it("does not say the event moved while the recurring dialog is open", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
    });
    await screen.findAllByText("Daily standup");
    focusGrid();
    await user.keyboard("{PageUp}{PageUp}{Enter}m{PageDown}{Enter}");
    await screen.findByText(/update recurring event/i);

    expect(spoken()).not.toMatch(/^Moved/);
  });

  it("ignores Alt on the resize combinations", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await pickUp(user);
    await user.keyboard(
      "{Control>}{Shift>}{Alt>}{ArrowUp}{/Alt}{/Shift}{/Control}",
    );

    expect(spoken()).toContain("Moving Planning");
    expect((await getEventBlock("Planning")).style.height).toBe("60px");
  });

  it("ignores Shift with the move keys", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
    });
    await pickUp(user);
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(getDayCell(2).contains(await getEventBlock("Planning"))).toBe(true);
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(getDayCell(2).contains(await getEventBlock("Planning"))).toBe(true);
    await user.keyboard("{Shift>}{PageDown}{/Shift}");
    expect((await getEventBlock("Planning")).style.top).toBe("540px");
    await user.keyboard("{Shift>}{PageUp}{/Shift}");
    expect((await getEventBlock("Planning")).style.top).toBe("540px");
  });

  it("does not undo an earlier change while picked up", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await pickUp(user);
    await user.keyboard("{PageDown}{Enter}");
    await advanceSave();
    await user.keyboard("m{ArrowDown}{Control>}z{/Control}");
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      day.plus({ hours: 10 }).toISO(),
    );
    expect(await top("Planning")).toBe("605px");
    await user.keyboard("{Enter}");
    await advanceSave();
    expect(getLastSavedEvents(saveEvents)[0].start.toISO()).toBe(
      day.plus({ hours: 10, minutes: 5 }).toISO(),
    );
  });

  it("keeps the time of day in the focus after crossing into another week", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
    });
    await pickUp(user);
    await user.keyboard(
      "{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{Enter}",
    );
    await user.keyboard("{ArrowDown}");

    expect(spoken()).toContain("9:05 AM, Monday 23 March");
  });

  it("scrolls the moved event into view", async () => {
    const scrollTo = vi.fn();
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await focusPlanning(user);
    grid().scrollTo = scrollTo;
    grid().scrollTop = 0;
    Object.defineProperty(grid(), "clientHeight", { value: 100 });
    await user.keyboard("m{PageDown}");

    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
  });

  describe("scrolling to follow the moved event", () => {
    const setUpScroll = (scrollTop: number) => {
      const scrollTo = vi.fn();
      grid().scrollTo = scrollTo;
      grid().scrollTop = scrollTop;
      Object.defineProperty(grid(), "clientHeight", { value: 600 });
      return scrollTo;
    };

    it("keeps the bottom edge visible when moving down", async () => {
      const { user } = renderCalendar({ events: [buildPlainEvent()] });
      await pickUp(user);
      const scrollTo = setUpScroll(0);
      await user.keyboard("{PageDown}");

      // 11:00 is at 660px; the 48px header covers the bottom of the viewport
      expect(scrollTo).toHaveBeenLastCalledWith(
        expect.objectContaining({ top: 660 - (600 - 48) }),
      );
    });

    it("keeps the top edge visible when moving up", async () => {
      const { user } = renderCalendar({ events: [buildPlainEvent()] });
      await pickUp(user);
      const scrollTo = setUpScroll(600);
      await user.keyboard("{PageUp}");

      expect(scrollTo).toHaveBeenLastCalledWith(
        expect.objectContaining({ top: 480 }),
      );
    });

    it("keeps the bottom edge visible while growing the end", async () => {
      const { user } = renderCalendar({ events: [buildPlainEvent()] });
      await pickUp(user);
      const scrollTo = setUpScroll(0);
      await user.keyboard("{Shift>}{ArrowDown}{/Shift}");

      // the event now ends at 10:05, 605px
      expect(scrollTo).toHaveBeenLastCalledWith(
        expect.objectContaining({ top: 605 - (600 - 48) }),
      );
    });

    describe("with an event taller than the viewport", () => {
      const tall = buildEvent({
        id: "tall",
        title: "Tall",
        start: day.plus({ hours: 1 }),
        end: day.plus({ hours: 20 }),
      });

      const pickUpTall = async () => {
        const { user } = renderCalendar({ events: [tall] });
        await screen.findByText("Tall");
        focusGrid();
        await user.keyboard("{Enter}m");
        return { user, scrollTo: setUpScroll(500) };
      };

      it("favours the bottom edge when moving down", async () => {
        const { user, scrollTo } = await pickUpTall();
        await user.keyboard("{PageDown}");

        // ends at 21:00, 1260px
        expect(scrollTo).toHaveBeenLastCalledWith(
          expect.objectContaining({ top: 1260 - 552 }),
        );
      });

      it("favours the top edge when moving up", async () => {
        const { user, scrollTo } = await pickUpTall();
        await user.keyboard("{PageUp}");

        expect(scrollTo).toHaveBeenLastCalledWith(
          expect.objectContaining({ top: 0 }),
        );
      });
    });

    it("scrolls to the start of the next day when the event moves past midnight", async () => {
      const late = buildEvent({
        id: "late",
        title: "Late",
        start: day.plus({ hours: 23 }),
        end: day.plus({ hours: 24 }),
      });
      const { user } = renderCalendar({ events: [late] });
      await screen.findByText("Late");
      focusGrid();
      await user.keyboard("{End}{Enter}m");
      const scrollTo = setUpScroll(1000);
      await user.keyboard("{PageDown}");

      expect(spoken()).toContain("Thursday 19 March");
      expect(scrollTo).toHaveBeenLastCalledWith(
        expect.objectContaining({ top: 0 }),
      );
    });

    it("moves the focus to the next day column when the event moves past midnight", async () => {
      const late = buildEvent({
        id: "late",
        title: "Late",
        start: day.plus({ hours: 23 }),
        end: day.plus({ hours: 24 }),
      });
      const { user } = renderCalendar({ mode: "week", events: [late] });
      await screen.findByText("Late");
      focusGrid();
      await user.keyboard("{End}{Enter}m{PageDown}");

      expect(getDayCell(3).contains(activeElement())).toBe(true);
      await user.keyboard("{Enter}");
      expect(activeElement()).toHaveAccessibleName(
        expect.stringContaining("Moved Late to Thursday 19 March"),
      );
      expect(spoken()).toContain("Moved Late to Thursday 19 March");
    });
  });

  it("prevents the default action of the pick-up key, in either case", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await focusPlanning(user);

    expect(fireEvent.keyDown(grid(), { key: "M", shiftKey: true })).toBe(false);
    expect(spoken()).toContain("Moving Planning");
  });

  it("clears an earlier selection when a different event is picked up", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
    });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{ }");
    await user.keyboard("{PageDown}".repeat(4));
    await user.keyboard("{Enter}m");

    expect(isSelected(await getEventBlock("Planning"))).toBe(false);
  });

  it("commits selected events that changed even if the picked up one could not", async () => {
    seedSettings({ snapMinutes: 60 });
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      saveEvents,
      events: [
        buildPlainEvent(),
        buildEvent({
          id: "long",
          title: "Long",
          start: day.plus({ hours: 13 }),
          end: day.plus({ hours: 15 }),
        }),
      ],
    });
    await screen.findByText("Planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{ }");
    await user.keyboard("{PageDown}{PageDown}{PageDown}{PageDown}");
    await user.keyboard("{Enter}{ }");
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    focusGrid();
    await user.keyboard("{PageUp}{PageUp}{PageUp}{PageUp}{Enter}");
    await user.keyboard("m{Shift>}{ArrowUp}{/Shift}{Enter}");
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved.find((e) => e.id === "plain-event")!.end.toISO()).toBe(
      day.plus({ hours: 10 }).toISO(),
    );
    expect(saved.find((e) => e.id === "long")!.end.toISO()).toBe(
      day.plus({ hours: 14 }).toISO(),
    );
  });

  it("keeps Alt and Meta combinations from moving, resizing or changing the date", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
    });
    await pickUp(user);
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

    await user.keyboard("{Alt>}{ArrowLeft}{ArrowDown}{/Alt}");
    await settle();
    expect(screen.getByText("Wed 18")).toBeInTheDocument();

    await user.keyboard("{Meta>}{ArrowRight}{PageDown}{/Meta}");
    await settle();
    expect(screen.getByText("Wed 18")).toBeInTheDocument();

    await user.keyboard(
      "{Control>}{Shift>}{Alt>}{ArrowUp}{/Alt}{/Shift}{/Control}",
    );
    await settle();

    const block = await getEventBlock("Planning");
    expect(getDayCell(2).contains(block)).toBe(true);
    expect(block.style.top).toBe("540px");
    expect(block.style.height).toBe("60px");
  });

  it("keeps resizing every selected event from where it is now", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });
    await focusPlanning(user);
    await user.keyboard("{ }");
    await user.keyboard("{PageDown}".repeat(4));
    await user.keyboard("{Enter}{ }m");
    await user.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}{Enter}");
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved.find((e) => e.id === "plain-event")!.end.toISO()).toBe(
      day.plus({ hours: 10, minutes: 10 }).toISO(),
    );
    expect(saved.find((e) => e.id === "second-event")!.end.toISO()).toBe(
      day.plus({ hours: 14, minutes: 10 }).toISO(),
    );
  });
});
