import { describe, expect, it } from "vitest";
import {
  getMovedEvent,
  findFreeSlotForEvent,
} from "../../src/lib/calendar/moveHelpers";
import type { DateTime } from "luxon";
import type {
  CalendarEvent,
  OccurrenceOverride,
} from "../../src/types/calendar/Event.ts";
import { FIXED_NOW, buildEvent, setupCalendarTests } from "./helpers";

setupCalendarTests();

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

  it("findFreeSlotForEvent finds a slot where every selected event fits", () => {
    const day = FIXED_NOW.startOf("day");
    const at = (id: string, from: number, to: number) =>
      buildEvent({
        id,
        start: day.plus({ hours: from }),
        end: day.plus({ hours: to }),
      });
    const a = at("a", 9, 10);
    const b = at("b", 11, 12);
    const blocker = at("blocker", 14, 15);

    const slot = findFreeSlotForEvent(
      [a, b, blocker],
      a,
      "forward",
      [a, b],
    );
    expect(slot?.start.toISO()).toBe(day.plus({ hours: 13 }).toISO());
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

  it("findFreeSlotForEvent ignores a completed task occupying the candidate slot", () => {
    const target = buildEvent({
      id: "target-completed",
      start: FIXED_NOW.startOf("day").plus({ hours: 9 }),
      end: FIXED_NOW.startOf("day").plus({ hours: 10 }),
    });

    const completedTask = buildEvent({
      id: "completed-task",
      title: "Completed task",
      isTask: true,
      completed: true,
      start: FIXED_NOW.startOf("day").plus({ hours: 10 }),
      end: FIXED_NOW.startOf("day").plus({ hours: 11 }),
    });

    const slot = findFreeSlotForEvent(
      [target, completedTask],
      target,
      "forward",
    );
    expect(slot).not.toBeNull();
    expect(slot?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 10 }).toISO(),
    );
    expect(slot?.end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 11 }).toISO(),
    );
  });

  it("findFreeSlotForEvent ignores a completed occurrence of a recurring task but still blocks on incomplete occurrences", () => {
    const recurringTask = buildEvent({
      id: "recurring-task",
      title: "Recurring task",
      isTask: true,
      start: FIXED_NOW.startOf("day").plus({ hours: 10 }),
      end: FIXED_NOW.startOf("day").plus({ hours: 11 }),
      repeat: { interval: 1, unit: "day" as const },
      completedInstances: [FIXED_NOW.toISODate()!],
    });

    const target = buildEvent({
      id: "target-recurring-completed",
      start: FIXED_NOW.startOf("day").plus({ hours: 9 }),
      end: FIXED_NOW.startOf("day").plus({ hours: 10 }),
    });

    const slot = findFreeSlotForEvent(
      [target, recurringTask],
      target,
      "forward",
    );
    expect(slot?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 10 }).toISO(),
    );

    const nextDayTarget = buildEvent({
      id: "target-recurring-completed-2",
      start: FIXED_NOW.startOf("day").plus({ days: 1, hours: 9 }),
      end: FIXED_NOW.startOf("day").plus({ days: 1, hours: 10 }),
    });

    const nextDaySlot = findFreeSlotForEvent(
      [nextDayTarget, recurringTask],
      nextDayTarget,
      "forward",
    );
    expect(nextDaySlot?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 11 }).toISO(),
    );
  });

  it("findFreeSlotForEvent ignores all day events", () => {
    const day = FIXED_NOW.startOf("day");
    const target = buildEvent({
      id: "target-all-day",
      start: day.plus({ hours: 9 }),
      end: day.plus({ hours: 10 }),
    });
    const holiday = buildEvent({
      id: "holiday",
      allDay: true,
      start: day,
      end: day.endOf("day"),
    });
    const busy = buildEvent({
      id: "busy",
      start: day.plus({ hours: 10 }),
      end: day.plus({ hours: 11 }),
    });

    const forward = findFreeSlotForEvent(
      [target, holiday, busy],
      target,
      "forward",
    );
    expect(forward?.start.toISO()).toBe(day.plus({ hours: 11 }).toISO());

    const backward = findFreeSlotForEvent(
      [target, holiday],
      target,
      "backward",
    );
    expect(backward?.start.toISO()).toBe(day.plus({ hours: 8 }).toISO());
  });

  it("findFreeSlotForEvent ignores recurring all day occurrences", () => {
    const day = FIXED_NOW.startOf("day");
    const target = buildEvent({
      id: "target-recurring-all-day",
      start: day.plus({ hours: 9 }),
      end: day.plus({ hours: 10 }),
    });
    const repeat = { interval: 1, unit: "day" as const };
    const series = buildEvent({
      id: "series",
      allDay: true,
      start: day,
      end: day.endOf("day"),
      repeat,
    });

    const slot = findFreeSlotForEvent([target, series], target, "forward");
    expect(slot?.start.toISO()).toBe(day.plus({ hours: 10 }).toISO());
  });

  describe("recurring series with overrides", () => {
    const day = FIXED_NOW.startOf("day");
    const tomorrow = day.plus({ days: 1 });
    const key = (d: DateTime) => d.toUTC().toISODate()!;
    const target = (at: DateTime, hour: number) =>
      buildEvent({
        id: "target-series",
        start: at.plus({ hours: hour }),
        end: at.plus({ hours: hour + 1 }),
      });
    const series = (
      overrides?: Record<string, OccurrenceOverride>,
      from = day,
    ) =>
      buildEvent({
        id: "series",
        start: from.plus({ hours: 10 }),
        end: from.plus({ hours: 11 }),
        repeat: { interval: 1, unit: "day" as const, overrides },
      });
    const forward = (events: CalendarEvent[], t: CalendarEvent) =>
      findFreeSlotForEvent([t, ...events], t, "forward")?.start.toISO();

    it("ignores a series occurrence overridden to all day", () => {
      const t = target(tomorrow, 9);

      expect(forward([series()], t)).toBe(tomorrow.plus({ hours: 11 }).toISO());
      expect(
        forward([series({ [key(tomorrow)]: { allDay: true } })], t),
      ).toBe(tomorrow.plus({ hours: 10 }).toISO());
    });

    it("uses the shifted time of an overridden occurrence", () => {
      const moved = series({
        [key(tomorrow)]: { startShift: 2 * 3600000, endShift: 2 * 3600000 },
      });

      expect(forward([moved], target(tomorrow, 9))).toBe(
        tomorrow.plus({ hours: 10 }).toISO(),
      );
      expect(forward([moved], target(tomorrow, 11))).toBe(
        tomorrow.plus({ hours: 13 }).toISO(),
      );
    });

    it("finds an occurrence shifted into the range from another day", () => {
      const moved = series({
        [key(tomorrow)]: { startShift: -23 * 3600000, endShift: -23 * 3600000 },
      });

      expect(forward([moved], target(day, 9))).toBe(
        day.plus({ hours: 12 }).toISO(),
      );
      expect(forward([moved], target(tomorrow, 9))).toBe(
        tomorrow.plus({ hours: 10 }).toISO(),
      );
    });

    it("keeps an override left behind before the series anchor", () => {
      const leftBehind = series({ [key(day)]: { title: "Kept" } }, tomorrow);

      expect(forward([leftBehind], target(day, 9))).toBe(
        day.plus({ hours: 11 }).toISO(),
      );
    });
  });

  it("findFreeSlotForEvent returns null when nothing is free within the search horizon", () => {
    const target = buildEvent({
      id: "target-horizon",
      start: FIXED_NOW.startOf("day").plus({ hours: 9 }),
      end: FIXED_NOW.startOf("day").plus({ hours: 10 }),
    });

    // a single event blocking the rest of the entire search horizon
    const blocker = buildEvent({
      id: "blocker",
      start: FIXED_NOW.startOf("day").plus({ hours: 10 }),
      end: FIXED_NOW.startOf("day").plus({ days: 1000 }),
    });

    const slot = findFreeSlotForEvent([target, blocker], target, "forward");
    expect(slot).toBeNull();
  });
});
