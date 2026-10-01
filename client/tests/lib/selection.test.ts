import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { createSelectionStore } from "../../src/lib/calendar/selection.ts";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";

const event = (
  id: string,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id,
  title: id,
  start: DateTime.fromISO("2026-03-18T09:00"),
  end: DateTime.fromISO("2026-03-18T10:00"),
  timestamp: 0,
  ...extra,
});

describe("selection store", () => {
  it("toggles an event in and out", () => {
    const store = createSelectionStore();

    store.toggle(event("a"));
    expect([...store.get().keys()]).toEqual(["a"]);

    store.toggle(event("a"));
    expect(store.get().size).toBe(0);
  });

  it("keys recurring instances apart from their parent", () => {
    const store = createSelectionStore();

    store.toggle(event("a"));
    store.toggle(event("a", { _instanceId: "a_2026-03-25", _parent: "a" }));

    expect([...store.get().keys()]).toEqual(["a", "a_2026-03-25"]);
  });

  it("replaces the selection", () => {
    const store = createSelectionStore();
    store.select([event("a"), event("b")]);

    store.select([event("c")]);

    expect([...store.get().keys()]).toEqual(["c"]);
  });

  it("keeps the same map and stays silent when the keys are unchanged", () => {
    const store = createSelectionStore();
    store.select([event("a"), event("b")]);
    const before = store.get();
    const listener = vi.fn();
    store.subscribe(listener);

    store.select([event("b"), event("a")]);

    expect(store.get()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("clears only when something is selected", () => {
    const store = createSelectionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.clear();
    expect(listener).not.toHaveBeenCalled();

    store.toggle(event("a"));
    store.clear();
    expect(store.get().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribing", () => {
    const store = createSelectionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.toggle(event("a"));

    expect(listener).not.toHaveBeenCalled();
  });
});
