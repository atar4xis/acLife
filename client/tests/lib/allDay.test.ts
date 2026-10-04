import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
import { makeOccurrence } from "../../src/lib/calendar/event.ts";
import { detachSingleOccurrence } from "../../src/lib/calendar/recurrence.ts";
import { describeWhen } from "../../src/lib/calendar/a11y.ts";

const start = DateTime.fromISO("2026-03-16T09:00");
const parent: CalendarEvent = {
  id: "p",
  title: "Standup",
  timestamp: 0,
  start,
  end: start.plus({ hours: 1 }),
  repeat: { interval: 1, unit: "day" },
};

const instance = (dayOffset: number): CalendarEvent => {
  const first = start.plus({ days: dayOffset });
  return makeOccurrence(
    parent,
    first,
    first.toISODate()!,
    parent.end.diff(parent.start),
  );
};

describe("all day recurring instances", () => {
  it("stores allDay as an override on the edited instance only", () => {
    const child = instance(2);
    const dispatch = vi.fn();
    detachSingleOccurrence(
      {
        ...child,
        allDay: true,
        start: child.start.startOf("day"),
        end: child.start.endOf("day"),
      },
      child.start,
      [parent],
      dispatch,
      vi.fn(),
      false,
    );

    const overrides = dispatch.mock.calls[0][0].data.repeat.overrides;
    expect(Object.values(overrides)).toEqual([
      expect.objectContaining({ allDay: true }),
    ]);
  });

  it("does not store allDay when it matches the series", () => {
    const child = instance(2);
    const dispatch = vi.fn();
    detachSingleOccurrence(
      { ...child, title: "Retro" },
      child.start,
      [parent],
      dispatch,
      vi.fn(),
      false,
    );

    const overrides = dispatch.mock.calls[0][0].data.repeat.overrides;
    expect(Object.values(overrides)[0]).not.toHaveProperty("allDay");
  });

  it("inherits allDay from the series unless overridden", () => {
    const build = (allDay?: boolean) =>
      makeOccurrence(
        {
          ...parent,
          allDay: true,
          repeat: {
            ...parent.repeat!,
            overrides: allDay === undefined ? {} : { "2026-03-18": { allDay } },
          },
        },
        start.plus({ days: 2 }),
        "2026-03-18",
        parent.end.diff(parent.start),
      );

    expect(build().allDay).toBe(true);
    expect(build(false).allDay).toBe(false);
  });
});

describe("describeWhen all day", () => {
  const allDay = (to: string): CalendarEvent => ({
    id: "a",
    title: "Trip",
    timestamp: 0,
    allDay: true,
    start: DateTime.fromISO("2026-03-16"),
    end: DateTime.fromISO(to).endOf("day"),
  });

  it("names a single day", () => {
    expect(describeWhen(allDay("2026-03-16"))).toBe("Monday 16 March, All day");
  });

  it("names the whole range for several days", () => {
    expect(describeWhen(allDay("2026-03-18"))).toContain("Wednesday 18 March");
  });
});
