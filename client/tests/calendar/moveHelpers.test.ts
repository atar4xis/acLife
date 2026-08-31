import { describe, expect, it } from "vitest";
import {
  getMovedEvent,
  findFreeSlotForEvent,
} from "../../src/lib/calendar/moveHelpers";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
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
