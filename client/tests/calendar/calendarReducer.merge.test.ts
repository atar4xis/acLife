import { describe, expect, it } from "vitest";
import { calendarReducer } from "../../src/reducers/calendarReducer";
import type { CalendarEvent } from "../../src/types/calendar/Event";

const ev = (id: string, timestamp: number) =>
  ({ id, timestamp }) as CalendarEvent;

describe("calendarReducer merge", () => {
  it("keeps local events missing from the incoming ones", () => {
    const state = [ev("local", 5)];

    const next = calendarReducer(state, {
      type: "merge",
      events: [ev("remote", 1)],
      deletedIds: [],
    });

    expect(next).toEqual([ev("local", 5), ev("remote", 1)]);
  });

  it("replaces an event only with a newer version", () => {
    const state = [ev("old", 1), ev("edited", 9)];

    const next = calendarReducer(state, {
      type: "merge",
      events: [ev("old", 2), ev("edited", 3)],
      deletedIds: [],
    });

    expect(next).toEqual([ev("old", 2), ev("edited", 9)]);
  });

  it("removes deleted events", () => {
    const next = calendarReducer([ev("a", 1), ev("b", 1)], {
      type: "merge",
      events: [],
      deletedIds: ["a"],
    });

    expect(next).toEqual([ev("b", 1)]);
  });
});
