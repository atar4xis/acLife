import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
import { makeOccurrence } from "../../src/lib/calendar/event.ts";
import { detachSingleOccurrence } from "../../src/lib/calendar/recurrence.ts";

const start = DateTime.fromISO("2026-03-16T09:00");
const parent: CalendarEvent = {
  id: "p",
  title: "Standup",
  timestamp: 0,
  start,
  end: start.plus({ hours: 1 }),
  repeat: { interval: 1, unit: "day" },
};

const occurrence = (series: CalendarEvent, dayOffset: number) => {
  const first = start.plus({ days: dayOffset });
  return makeOccurrence(
    series,
    first,
    first.toISODate()!,
    series.end.diff(series.start),
  );
};

describe("task recurring instances", () => {
  it("stores isTask as an override on the edited instance only", () => {
    const child = occurrence(parent, 2);
    const dispatch = vi.fn();

    detachSingleOccurrence(
      { ...child, isTask: true },
      child.start,
      [parent],
      dispatch,
      vi.fn(),
      false,
    );

    const saved = dispatch.mock.calls[0][0].data as CalendarEvent;
    expect(Object.values(saved.repeat!.overrides!)).toEqual([
      expect.objectContaining({ isTask: true }),
    ]);
    expect(saved.isTask).toBeUndefined();
  });

  it("does not store isTask when it matches the series", () => {
    const child = occurrence(parent, 2);
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
    expect(Object.values(overrides)[0]).not.toHaveProperty("isTask");
  });

  it("applies the override and its completion to one instance", () => {
    const series: CalendarEvent = {
      ...parent,
      completedInstances: ["2026-03-18"],
      repeat: {
        ...parent.repeat!,
        overrides: { "2026-03-18": { isTask: true } },
      },
    };

    expect(occurrence(series, 2)).toMatchObject({
      isTask: true,
      completed: true,
    });
    expect(occurrence(series, 1).isTask).toBeUndefined();
    expect(occurrence(series, 1).completed).toBeUndefined();
  });

  it("lets an instance opt out of a task series", () => {
    const series: CalendarEvent = {
      ...parent,
      isTask: true,
      repeat: {
        ...parent.repeat!,
        overrides: { "2026-03-18": { isTask: false } },
      },
    };

    expect(occurrence(series, 2)).toMatchObject({
      isTask: false,
      completed: undefined,
    });
    expect(occurrence(series, 1).isTask).toBe(true);
  });
});
