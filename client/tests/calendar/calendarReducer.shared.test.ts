import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { calendarReducer } from "../../src/reducers/calendarReducer";
import {
  canDeleteEvent,
  canEditEvent,
  covers,
  isOwnEvent,
  mergeSources,
  spaceOf,
} from "../../src/lib/calendar/shared";
import type { CalendarEvent } from "../../src/types/calendar/Event";
import type { OwnedSpace, SharedInfo } from "../../src/types/Share";

const info = (extra: Partial<SharedInfo> = {}): SharedInfo => ({
  space: "s1",
  owner: "o1",
  scope: "collection",
  permission: "write",
  ...extra,
});

const at = DateTime.fromISO("2026-03-10T10:00:00Z", { zone: "utc" });
const event = (id: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  title: id,
  start: at,
  end: at.plus({ hours: 1 }),
  timestamp: 1000,
  ...extra,
});

describe("permissions of events", () => {
  it("lets me do everything with my own events", () => {
    expect(canEditEvent(event("a"))).toBe(true);
    expect(canDeleteEvent(event("a"))).toBe(true);
    expect(isOwnEvent(event("a"))).toBe(true);
  });

  it("gives a read-only member nothing", () => {
    const e = event("a", { _shared: info({ permission: "read" }) });
    expect(canEditEvent(e)).toBe(false);
    expect(canDeleteEvent(e)).toBe(false);
    expect(isOwnEvent(e)).toBe(false);
  });

  it("lets a writer of a single event edit but not delete it", () => {
    const e = event("a", { _shared: info({ scope: "item" }) });
    expect(canEditEvent(e)).toBe(true);
    expect(canDeleteEvent(e)).toBe(false);
  });

  it("lets a writer of a calendar edit and delete", () => {
    const e = event("a", { _shared: info() });
    expect(canEditEvent(e)).toBe(true);
    expect(canDeleteEvent(e)).toBe(true);
  });
});

describe("calendarReducer and shared events", () => {
  it("ignores updates and deletes of a read-only event", () => {
    const readOnly = event("a", { _shared: info({ permission: "read" }) });
    const state = [readOnly];
    expect(calendarReducer(state, { type: "update", id: "a", data: { title: "x" } })).toEqual(state);
    expect(calendarReducer(state, { type: "delete", id: "a" })).toEqual(state);
  });

  it("updates a writable shared event and keeps its space", () => {
    const writable = event("a", { _shared: info() });
    const [updated] = calendarReducer([writable], {
      type: "update",
      id: "a",
      data: { title: "x", _parent: "p" } as Partial<CalendarEvent>,
    });
    expect(updated.title).toBe("x");
    expect(updated._shared).toEqual(info());
    expect(updated).not.toHaveProperty("_parent");
    expect(updated.timestamp).toBeGreaterThan(1000);
  });

  it("does not let an update change the space of an event", () => {
    const [updated] = calendarReducer([event("a", { _shared: info() })], {
      type: "update",
      id: "a",
      data: { _shared: info({ space: "other" }) } as Partial<CalendarEvent>,
    });
    expect(updated._shared?.space).toBe("s1");
  });

  it("does not add a space to my own event by updating it", () => {
    const [updated] = calendarReducer([event("a")], {
      type: "update",
      id: "a",
      data: { _shared: info() } as Partial<CalendarEvent>,
    });
    expect(updated).not.toHaveProperty("_shared");
  });

  it("deletes a writable collection event and keeps single events", () => {
    expect(calendarReducer([event("a", { _shared: info() })], { type: "delete", id: "a" })).toEqual([]);
    const single = [event("a", { _shared: info({ scope: "item" }) })];
    expect(calendarReducer(single, { type: "delete", id: "a" })).toEqual(single);
  });

  it("only changes the event asked for", () => {
    const state = [event("a"), event("b", { _shared: info({ permission: "read" }) })];
    const next = calendarReducer(state, { type: "update", id: "a", data: { title: "x" } });
    expect(next[1]).toBe(state[1]);
  });
});

describe("helpers", () => {
  it("finds the space of a change", () => {
    expect(spaceOf({ type: "deleted", id: "a", space: "s9" })).toBe("s9");
    expect(spaceOf({ type: "updated", event: event("a", { _shared: info() }) })).toBe("s1");
    expect(spaceOf({ type: "updated", event: event("a") })).toBeUndefined();
    expect(spaceOf({ type: "deleted", id: "a" })).toBeUndefined();
  });

  it("covers everything for a whole calendar and one id for an event", () => {
    const space = (target: string | null) => ({ target }) as OwnedSpace;
    expect(covers(space(null), "any")).toBe(true);
    expect(covers(space("a"), "a")).toBe(true);
    expect(covers(space("a"), "b")).toBe(false);
  });

  it("merges sources preferring my own and the first of a repeat", () => {
    const own = [event("a", { title: "mine" })];
    const shared = [
      event("a", { title: "shared" }),
      event("b", { title: "first" }),
      event("b", { title: "second" }),
    ];
    expect(mergeSources(own, shared).map((e) => e.title)).toEqual(["mine", "first"]);
  });
});
