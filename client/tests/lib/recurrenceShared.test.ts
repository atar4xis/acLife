import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import {
  detachSingleOccurrence,
  splitSeries,
} from "../../src/lib/calendar/recurrence.ts";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
import type { SharedInfo } from "../../src/types/Share.ts";

const start = DateTime.fromISO("2026-03-02T09:00", { zone: "utc" });

const info = (scope: SharedInfo["scope"]): SharedInfo => ({
  space: "s1",
  owner: "o1",
  scope,
  permission: "write",
});

const series = (scope: SharedInfo["scope"]): CalendarEvent => ({
  id: "series",
  title: "Standup",
  start,
  end: start.plus({ hours: 1 }),
  timestamp: 0,
  repeat: { interval: 1, unit: "day" },
  _shared: info(scope),
});

const occurrence = (parent: CalendarEvent): CalendarEvent => ({
  ...parent,
  start: start.plus({ days: 2 }),
  end: start.plus({ days: 2, hours: 1 }),
  _parent: parent.id,
  _instanceId: "series-2",
  _overrideKey: "2026-03-04",
});

describe("detaching and splitting shared events", () => {
  it("keeps the detached occurrence in the space", () => {
    const parent = series("collection");
    const updateChange = vi.fn();

    detachSingleOccurrence(
      occurrence(parent),
      start.plus({ days: 2 }),
      [parent],
      vi.fn(),
      updateChange,
    );

    const added = updateChange.mock.calls
      .map(([change]) => change)
      .find((change) => change.type === "added");
    expect(added.event._shared).toEqual(info("collection"));
  });

  it("keeps the tail of a split series in the space", () => {
    const parent = series("collection");

    const { created } = splitSeries(
      parent,
      occurrence(parent),
      false,
    );

    expect(created._shared).toEqual(info("collection"));
  });

  it("overrides instead of adding a record when the space has an item scope", () => {
    const parent = series("item");
    const updateChange = vi.fn();

    detachSingleOccurrence(
      occurrence(parent),
      start.plus({ days: 2 }),
      [parent],
      vi.fn(),
      updateChange,
    );

    const types = updateChange.mock.calls.map(([change]) => change.type);
    expect(types).toEqual(["updated"]);
  });
});
