import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import {
  ALL_DAY_SLOT,
  createGridFocusStore,
  eventDomId,
  eventsAtSlot,
  lastSlot,
  adjacentEvent,
  moveFocus,
  moveStepForKey,
} from "../../src/lib/calendar/gridFocus.ts";
import { describeSlot } from "../../src/lib/calendar/a11y.ts";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";

const day = DateTime.fromISO("2026-03-18T00:00:00");
const ev = (id: string, startH: number, endH: number): CalendarEvent => ({
  id,
  title: id,
  start: day.plus({ hours: startH }),
  end: day.plus({ hours: endH }),
  timestamp: 0,
});

const opts = { snapMins: 15, dayCount: 7 };

describe("lastSlot", () => {
  it("is the last snap boundary of the day", () => {
    expect(lastSlot(15)).toBe(1425);
    expect(lastSlot(5)).toBe(1435);
    expect(lastSlot(30)).toBe(1410);
    expect(lastSlot(45)).toBe(1395);
  });
});

describe("moveFocus", () => {
  const at = { day: 3, minutes: 600 };

  it("steps by the snap size vertically", () => {
    expect(moveFocus(at, "ArrowUp", opts)).toEqual({
      day: 3,
      minutes: 585,
      dayShift: 0,
    });
    expect(moveFocus(at, "ArrowDown", opts)).toEqual({
      day: 3,
      minutes: 615,
      dayShift: 0,
    });
    expect(moveFocus(at, "ArrowDown", { ...opts, snapMins: 5 })?.minutes).toBe(
      605,
    );
  });

  it("moves an hour with PageUp and PageDown", () => {
    expect(moveFocus(at, "PageUp", opts)?.minutes).toBe(540);
    expect(moveFocus(at, "PageDown", opts)?.minutes).toBe(660);
  });

  it("jumps to the start and end of the day", () => {
    expect(moveFocus(at, "Home", opts)?.minutes).toBe(0);
    expect(moveFocus(at, "End", opts)?.minutes).toBe(1425);
  });

  it("clamps at the day edges", () => {
    expect(moveFocus({ day: 0, minutes: 0 }, "ArrowUp", opts)?.minutes).toBe(0);
    expect(moveFocus({ day: 0, minutes: 30 }, "PageUp", opts)?.minutes).toBe(0);
    expect(
      moveFocus({ day: 0, minutes: 1425 }, "ArrowDown", opts)?.minutes,
    ).toBe(1425);
    expect(
      moveFocus({ day: 0, minutes: 1400 }, "PageDown", opts)?.minutes,
    ).toBe(1425);
  });

  it("changes day horizontally and keeps the time", () => {
    expect(moveFocus(at, "ArrowLeft", opts)).toEqual({
      day: 2,
      minutes: 600,
      dayShift: 0,
    });
    expect(moveFocus(at, "ArrowRight", opts)).toEqual({
      day: 4,
      minutes: 600,
      dayShift: 0,
    });
  });

  it("moves left from the second day without shifting", () => {
    expect(moveFocus({ day: 1, minutes: 60 }, "ArrowLeft", opts)).toEqual({
      day: 0,
      minutes: 60,
      dayShift: 0,
    });
  });

  it("reports a shift when leaving the visible days", () => {
    expect(moveFocus({ day: 0, minutes: 60 }, "ArrowLeft", opts)).toEqual({
      day: 6,
      minutes: 60,
      dayShift: -1,
    });
    expect(moveFocus({ day: 6, minutes: 60 }, "ArrowRight", opts)).toEqual({
      day: 0,
      minutes: 60,
      dayShift: 1,
    });
    expect(
      moveFocus({ day: 0, minutes: 60 }, "ArrowLeft", { ...opts, dayCount: 1 }),
    ).toEqual({ day: 0, minutes: 60, dayShift: -1 });
    expect(
      moveFocus({ day: 0, minutes: 60 }, "ArrowRight", {
        ...opts,
        dayCount: 1,
      }),
    ).toEqual({ day: 0, minutes: 60, dayShift: 1 });
  });

  it("ignores other keys", () => {
    expect(moveFocus(at, "a", opts)).toBeNull();
  });
});

describe("eventsAtSlot", () => {
  const events = [ev("b", 9.5, 11), ev("a", 9, 10), ev("c", 10, 11)];

  it("returns overlapping events ordered by start", () => {
    expect(eventsAtSlot(events, day, 9 * 60 + 30, 15).map((e) => e.id)).toEqual(
      ["a", "b"],
    );
  });

  it("uses the whole slot, not just its start", () => {
    expect(
      eventsAtSlot([ev("x", 9.1, 9.2)], day, 9 * 60, 15).map((e) => e.id),
    ).toEqual(["x"]);
  });

  it("excludes events ending at the slot start or starting at its end", () => {
    expect(
      eventsAtSlot(events, day, 10 * 60 - 15, 15).map((e) => e.id),
    ).toEqual(["a", "b"]);
    expect(eventsAtSlot([ev("a", 9, 10)], day, 10 * 60, 15)).toEqual([]);
    expect(eventsAtSlot([ev("a", 9, 10)], day, 9 * 60 - 15, 15)).toEqual([]);
  });

  it("handles a missing day", () => {
    expect(eventsAtSlot(undefined, day, 0, 15)).toEqual([]);
  });

  it("breaks start ties by key", () => {
    const tied = [ev("z", 9, 10), ev("m", 9, 10)];
    expect(eventsAtSlot(tied, day, 540, 15).map((e) => e.id)).toEqual([
      "m",
      "z",
    ]);
  });
});

describe("adjacentEvent", () => {
  const next = day.plus({ days: 1 });
  const nextEv = (id: string, startH: number, endH: number) => ({
    ...ev(id, startH, endH),
    start: next.plus({ hours: startH }),
    end: next.plus({ hours: endH }),
  });
  const days = [
    { date: day, events: [ev("late", 15, 16), ev("b", 9, 10), ev("a", 9, 10)] },
    { date: next, events: [nextEv("n", 8, 9)] },
  ];
  const at = (day: number, hour: number, eventKey: string | null = null) => ({
    day,
    minutes: hour * 60,
    eventKey,
  });
  const key = (from: ReturnType<typeof at>, dir: 1 | -1) =>
    adjacentEvent(days, from, dir, 15)?.eventKey ?? null;

  it("goes to the first later event from a slot", () => {
    expect(key(at(0, 8), 1)).toBe("a");
    expect(key(at(0, 9), 1)).toBe("late");
    expect(key(at(0, 16), 1)).toBe("n");
  });

  it("goes to the last earlier event from a slot, including one the slot is inside", () => {
    expect(key(at(0, 16), -1)).toBe("late");
    expect(key(at(0, 9.5), -1)).toBe("b");
    expect(key(at(0, 9), -1)).toBeNull();
    expect(key(at(1, 7), -1)).toBe("late");
  });

  it("steps through events in start order, with ties by key", () => {
    expect(key(at(0, 9, "a"), 1)).toBe("b");
    expect(key(at(0, 9, "b"), 1)).toBe("late");
    expect(key(at(0, 9, "b"), -1)).toBe("a");
    expect(key(at(1, 8, "n"), -1)).toBe("late");
  });

  it("lands on the slot the event starts in, on its day", () => {
    expect(adjacentEvent(days, at(0, 16), 1, 15)).toEqual({
      day: 1,
      minutes: 8 * 60,
      eventKey: "n",
    });
  });

  it("is null past the first and last event", () => {
    expect(key(at(0, 9, "a"), -1)).toBeNull();
    expect(key(at(1, 8, "n"), 1)).toBeNull();
    expect(key(at(1, 9), 1)).toBeNull();
  });

  it("treats a multi-day event as starting at the top of each later day", () => {
    const span = {
      ...ev("span", 22, 26),
      end: day.plus({ hours: 26 }),
    };
    const evening = ev("evening", 23, 23.5);
    const both = [
      { date: day, events: [span, evening] },
      { date: next, events: [span, nextEv("n", 8, 9)] },
    ];

    expect(adjacentEvent(both, at(0, 22, "span"), 1, 15)?.eventKey).toBe(
      "evening",
    );
    expect(adjacentEvent(both, at(0, 23, "evening"), 1, 15)).toEqual({
      day: 1,
      minutes: 0,
      eventKey: "span",
    });
    expect(adjacentEvent(both, at(1, 0, "span"), 1, 15)?.eventKey).toBe("n");
  });
});

describe("describeSlot", () => {
  it("names time and date, and marks today and events", () => {
    expect(describeSlot(day, 9 * 60 + 15, false, [])).toBe(
      "9:15 AM, Wednesday 18 March 2026",
    );
    expect(describeSlot(day, 0, true, ["Standup"])).toBe(
      "12 AM, Wednesday 18 March 2026, today, 1 event: Standup",
    );
    expect(describeSlot(day, 13 * 60, false, ["Lunch", "Call"])).toBe(
      "1 PM, Wednesday 18 March 2026, 2 events: Lunch, Call",
    );
  });
});

describe("createGridFocusStore", () => {
  it("notifies subscribers of focus changes and stops after unsubscribe", () => {
    const store = createGridFocusStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);

    store.setFocus({ day: 1, minutes: 30, eventKey: null });
    expect(store.getFocus()).toEqual({ day: 1, minutes: 30, eventKey: null });
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    store.setFocus(null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getFocus()).toBeNull();
  });

  it("notifies only when the keyboard mode changes", () => {
    const store = createGridFocusStore();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.getKeyboardMode()).toBe(false);
    store.setKeyboardMode(true);
    store.setKeyboardMode(true);

    expect(store.getKeyboardMode()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("makes a repeated spoken message a new one", () => {
    const store = createGridFocusStore();
    store.setSpoken(2, "hello");
    const first = store.getSpoken();
    store.setSpoken(2, "hello");

    expect(first).toMatchObject({ day: 2, text: "hello" });
    expect(store.getSpoken()).not.toBe(first);
    expect(store.getSpoken()!.id).toBe(first!.id + 1);
  });

  it("notifies once when a spoken message is cleared", () => {
    const store = createGridFocusStore();
    store.setSpoken(0, "hello");
    const listener = vi.fn();
    store.subscribe(listener);
    store.clearSpoken();
    store.clearSpoken();

    expect(store.getSpoken()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("eventDomId", () => {
  it("is unique per event and day", () => {
    const e = ev("a", 1, 2);
    expect(eventDomId(e, 0)).not.toBe(eventDomId(e, 1));
    expect(eventDomId(e, 2)).toContain("a");
  });
});

describe("moveStepForKey", () => {
  const key = (
    name: string,
    mods: Partial<
      Record<"shiftKey" | "ctrlKey" | "altKey" | "metaKey", boolean>
    > = {},
  ) =>
    moveStepForKey(
      {
        key: name,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        ...mods,
      },
      5,
    );

  it.each([
    ["ArrowUp", {}, { type: "move", days: 0, minutes: -5 }],
    ["ArrowDown", {}, { type: "move", days: 0, minutes: 5 }],
    ["PageUp", {}, { type: "move", days: 0, minutes: -60 }],
    ["PageDown", {}, { type: "move", days: 0, minutes: 60 }],
    ["ArrowLeft", {}, { type: "move", days: -1, minutes: 0 }],
    ["ArrowRight", {}, { type: "move", days: 1, minutes: 0 }],
    [
      "ArrowUp",
      { shiftKey: true },
      { type: "resize_end", days: 0, minutes: -5 },
    ],
    [
      "ArrowDown",
      { shiftKey: true },
      { type: "resize_end", days: 0, minutes: 5 },
    ],
    [
      "ArrowUp",
      { shiftKey: true, ctrlKey: true },
      { type: "resize_start", days: 0, minutes: -5 },
    ],
    [
      "ArrowDown",
      { shiftKey: true, ctrlKey: true },
      { type: "resize_start", days: 0, minutes: 5 },
    ],
  ])("maps %s with %j", (name, mods, step) => {
    expect(key(name, mods)).toEqual(step);
  });

  it.each([
    ["ArrowUp", { ctrlKey: true }],
    ["ArrowUp", { altKey: true }],
    ["ArrowUp", { metaKey: true }],
    ["ArrowUp", { shiftKey: true, altKey: true }],
    ["ArrowUp", { shiftKey: true, ctrlKey: true, altKey: true }],
    ["ArrowUp", { shiftKey: true, ctrlKey: true, metaKey: true }],
    ["PageUp", { shiftKey: true }],
    ["PageDown", { ctrlKey: true }],
    ["ArrowLeft", { shiftKey: true }],
    ["ArrowRight", { altKey: true }],
    ["Home", {}],
    ["a", {}],
  ])("ignores %s with %j", (name, mods) => {
    expect(key(name, mods)).toBeNull();
  });
});

describe("all day lane", () => {
  const lane = { ...opts, allDayLane: true };

  it("enters the strip by moving up from the first slot", () => {
    expect(moveFocus({ day: 0, minutes: 0 }, "ArrowUp", lane)?.minutes).toBe(
      ALL_DAY_SLOT,
    );
  });

  it("stays at the first slot without a lane", () => {
    expect(moveFocus({ day: 0, minutes: 0 }, "ArrowUp", opts)?.minutes).toBe(0);
  });

  it("leaves the strip downwards and stays on ArrowUp", () => {
    const from = { day: 2, minutes: ALL_DAY_SLOT };

    expect(moveFocus(from, "ArrowDown", lane)?.minutes).toBe(0);
    expect(moveFocus(from, "ArrowUp", lane)?.minutes).toBe(ALL_DAY_SLOT);
    expect(moveFocus(from, "PageDown", lane)?.minutes).toBe(60);
  });

  it("keeps the strip when changing day", () => {
    expect(
      moveFocus({ day: 2, minutes: ALL_DAY_SLOT }, "ArrowRight", lane)?.minutes,
    ).toBe(ALL_DAY_SLOT);
  });

  it("matches only all day events in the strip", () => {
    const allDay = { ...ev("holiday", 0, 24), allDay: true };
    const timed = ev("standup", 0, 1);

    expect(
      eventsAtSlot([allDay, timed], day, ALL_DAY_SLOT, 15).map((e) => e.id),
    ).toEqual(["holiday"]);
    expect(eventsAtSlot([allDay, timed], day, 0, 15).map((e) => e.id)).toEqual([
      "standup",
    ]);
  });

  it("describes the strip slot", () => {
    expect(describeSlot(day, ALL_DAY_SLOT, false, [])).toMatch(/^All day, /);
  });
});
