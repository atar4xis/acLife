import { describe, expect, it } from "vitest";
import { calendarReducer } from "../../src/reducers/calendarReducer";
import type { CalendarEvent } from "../../src/types/calendar/Event";

const ev = (id: string, timestamp: number) =>
  ({ id, timestamp }) as CalendarEvent;

describe("calendarReducer append", () => {
  it("adds events the state does not have, keeping known ones as they are", () => {
    const state = [ev("known", 5)];

    const next = calendarReducer(state, {
      type: "append",
      events: [ev("known", 9), ev("new", 1)],
    });

    expect(next).toEqual([ev("known", 5), ev("new", 1)]);
  });
});
