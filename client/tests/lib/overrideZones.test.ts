import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
import { getEventMap, makeOccurrence } from "../../src/lib/calendar/event.ts";
import { nominalOnDate, overrideSpan, slotKey } from "../../src/lib/calendar/occurrences.ts";
import { eventBucketLabels } from "../../src/lib/calendar/buckets.ts";
import {
  detachSingleOccurrence,
  endSeriesBefore,
  nearbyOccurrences,
  resetOccurrence,
  splitSeries,
  withShiftedOverrides,
} from "../../src/lib/calendar/recurrence.ts";

const ZONES = ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"];
const inZone = (iso: string, zone: string) =>
  DateTime.fromISO(iso, { zone: "utc" }).setZone(zone);
const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

const HOURS = ["02", "23"];
const series = (
  zone: string,
  repeat: object = {},
  hour = "23",
  day = "16",
): CalendarEvent => {
  const start = inZone(`2026-03-${day}T${hour}:00:00Z`, zone);
  return {
    id: "p",
    title: "Standup",
    timestamp: 0,
    start,
    end: start.plus({ hours: 1 }),
    repeat: { interval: 1, unit: "day", ...repeat },
  };
};

const utcIso = (day: string, hour: string) => `2026-03-${day}T${hour}:00:00.000Z`;

const instanceAt = (p: CalendarEvent, isoUtc: string) => {
  const nominal = nominalOnDate(p.start, isoUtc.slice(0, 10));
  return makeOccurrence(p, nominal, nominal.toISODate()!, p.end.diff(p.start));
};

describe("overrides across time zones", () => {
  it("round-trips a UTC date key to its occurrence at every wall time", () => {
    for (const zone of ZONES) {
      for (let hour = 0; hour < 24; hour++) {
        const anchor = inZone(`2026-03-16T${String(hour).padStart(2, "0")}:30:00Z`, zone);
        const nominal = nominalOnDate(anchor, "2026-03-20");

        expect(slotKey(nominal)).toBe("2026-03-20");
        expect(nominal.hour).toBe(anchor.hour);
        expect(nominal.minute).toBe(30);
      }
    }
  });

  it("keeps an override on the same occurrence in whatever zone it is shown", () => {
    for (const zone of ZONES) for (const hour of HOURS) {
      const p = series(zone, { overrides: { "2026-03-19": { title: "Override" } } }, hour);
      const days = Array.from({ length: 8 }, (_, i) => p.start.startOf("day").plus({ days: i }));
      const shown = [...getEventMap([p], days, [], []).values()]
        .flat()
        .filter((e) => e.title === "Override")
        .map((e) => e.start.toUTC().toISO());

      expect([...new Set(shown)], zone + hour).toEqual([utcIso("19", hour)]);
    }
  });

  it("shows an instance moved into the window from outside it", () => {
    const shift = 10 * 24 * 3600_000;
    for (const zone of ZONES) for (const hour of HOURS) {
      const p = series(zone, { overrides: { "2026-03-19": { startShift: shift, endShift: shift } } }, hour);
      const days = Array.from({ length: 3 }, (_, i) =>
        inZone(`2026-03-29T${hour}:00:00Z`, zone).startOf("day").plus({ days: i }),
      );
      const shown = [...getEventMap([p], days, [], []).values()]
        .flat()
        .filter((e) => e._overrideKey === "2026-03-19")
        .map((e) => e.start.toUTC().toISO());

      expect([...new Set(shown)], zone + hour).toEqual([utcIso("29", hour)]);
    }
  });

  it("shows an override left before the parent's start in any zone", () => {
    for (const zone of ZONES) for (const hour of HOURS) {
      const p = series(zone, { overrides: { "2026-03-18": { title: "Early" } } }, hour, "19");
      const days = Array.from({ length: 8 }, (_, i) =>
        inZone("2026-03-15T00:00:00Z", zone).startOf("day").plus({ days: i }),
      );
      const early = [...getEventMap([p], days, [], []).values()]
        .flat()
        .filter((e) => e.title === "Early");

      expect([...new Set(early.map((e) => e.start.toUTC().toISO()))], zone + hour).toEqual([
        utcIso("18", hour),
      ]);
    }
  });

  it("stores an edit under the occurrence's UTC date", () => {
    for (const zone of ZONES) for (const hour of HOURS) {
      const p = series(zone, {}, hour);
      const child = instanceAt(p, "2026-03-19");
      const dispatch = vi.fn();
      detachSingleOccurrence({ ...child, title: "Retro" }, child.start, [p], dispatch, vi.fn(), false);

      expect(Object.keys(dispatch.mock.calls[0][0].data.repeat.overrides), zone + hour).toEqual(["2026-03-19"]);
    }
  });

  it("resets and restores a promoted parent in any zone", () => {
    for (const zone of ZONES) for (const hour of HOURS) {
      const p = series(zone, {}, hour);
      const dispatch = vi.fn();
      detachSingleOccurrence({ ...p, title: "Kickoff" }, p.start, [p], dispatch, vi.fn(), false);
      const promoted = dispatch.mock.calls[0][0].data as CalendarEvent;
      expect(slotKey(promoted.start), zone + hour).toBe("2026-03-17");
      expect(Object.keys(promoted.repeat!.overrides!)).toEqual(["2026-03-16"]);

      const reset = vi.fn();
      resetOccurrence(instanceAt(promoted, "2026-03-16"), [promoted], reset, vi.fn());
      const restored = reset.mock.calls[0][0].data as CalendarEvent;

      expect(restored.start.toUTC().toISO(), zone + hour).toBe(utcIso("16", hour));
      expect(restored.repeat?.overrides).toBeUndefined();
    }
  });

  it("promotes past an overridden next occurrence in any zone", () => {
    for (const zone of ZONES) for (const hour of HOURS) {
      const p = series(zone, { overrides: { "2026-03-17": { title: "Next" } } }, hour);
      const dispatch = vi.fn();
      detachSingleOccurrence({ ...p, title: "Kickoff" }, p.start, [p], dispatch, vi.fn(), false);
      const promoted = dispatch.mock.calls[0][0].data as CalendarEvent;

      expect(promoted.start.toUTC().toISO(), zone + hour).toBe(utcIso("18", hour));
      expect(Object.keys(promoted.repeat!.overrides!).sort()).toEqual(["2026-03-16", "2026-03-17"]);
    }
  });

  it("counts a restored parent's occurrences in any zone", () => {
    for (const zone of ZONES) for (const hour of HOURS) {
      const p = series(zone, {
        count: 2,
        overrides: { "2026-03-16": { title: "First" }, "2026-03-17": { title: "Second" } },
      }, hour, "18");
      const reset = vi.fn();
      resetOccurrence(instanceAt(p, "2026-03-16"), [p], reset, vi.fn());
      const restored = reset.mock.calls[0][0].data as CalendarEvent;

      expect(restored.start.toUTC().toISO(), zone + hour).toBe(utcIso("16", hour));
      expect(restored.repeat?.count, zone + hour).toBe(4);
      expect(restored.repeat?.skip).toBeUndefined();
    }
  });

  it("splits at an overridden instance in any zone", () => {
    for (const zone of ZONES) for (const hour of HOURS) {
      const p = series(zone, { overrides: { "2026-03-18": { title: "Cut" }, "2026-03-21": { title: "After" } } }, hour);
      const { created, remaining } = splitSeries(p, instanceAt(p, "2026-03-18"), true);

      expect(Object.keys(created.repeat!.overrides!), zone + hour).toEqual(["2026-03-21"]);
      expect(remaining?.repeat?.overrides).toBeUndefined();
    }
  });

  it("recognises a split before the parent's start in any zone", () => {
    for (const zone of ZONES) for (const hour of HOURS) {
      const p = series(zone, { overrides: { "2026-03-17": { title: "Early" }, "2026-03-18": { title: "Cut" } } }, hour, "19");

      expect(splitSeries(p, instanceAt(p, "2026-03-18"), false).remaining, zone + hour).toBeNull();
    }
  });

  it("recognises a cut before the parent's start in any zone", () => {
    for (const zone of ZONES) for (const hour of HOURS) {
      const p = series(zone, { overrides: { "2026-03-17": { title: "Early" }, "2026-03-18": { title: "Cut" } } }, hour, "19");
      const dispatch = vi.fn();
      const done = endSeriesBefore(p, instanceAt(p, "2026-03-18"), dispatch, vi.fn());

      expect(done, zone + hour).toBe(true);
      expect(dispatch.mock.calls.filter((c) => c[0].type === "add").map((c) => c[0].event.title)).toEqual(["Early"]);
    }
  });

  it("applies overrides to search results in any zone", () => {
    for (const zone of ZONES) for (const hour of HOURS) {
      const p = series(zone, { overrides: { "2026-03-19": { title: "Override" } } }, hour);
      const found = nearbyOccurrences(p, at("2026-03-19T12:00:00Z"), 3);

      expect(found.filter((e) => e.title === "Override").map((e) => e.start.toUTC().toISO()), zone + hour).toEqual([utcIso("19", hour)]);
    }
  });

  it("labels the weeks of an override by its UTC time", () => {
    const shift = 9 * 24 * 3600_000;
    const labels = eventBucketLabels(
      series("Asia/Tokyo", { count: 2, overrides: { "2026-03-17": { startShift: shift, endShift: shift } } }),
    );

    expect(labels).toEqual(["2026-W12", "2026-W13"]);
  });
  it("keeps overrides and skips on their occurrences when the local day changes but the UTC day does not", () => {
    const zone = "Asia/Karachi";
    const p = series(zone, { unit: "week", overrides: { "2026-03-23": { title: "Override" } }, skip: ["2026-03-30"] }, "17");
    const movedStart = inZone("2026-03-16T21:00:00Z", zone);
    const moved = { ...p, start: movedStart, end: movedStart.plus({ hours: 1 }) };

    const shifted = withShiftedOverrides(p, moved);
    expect(Object.keys(shifted.repeat!.overrides!)).toEqual(["2026-03-23"]);

    const { created } = splitSeries(p, { ...instanceAt(p, "2026-03-23"), start: inZone("2026-03-23T21:00:00Z", zone), end: inZone("2026-03-23T22:00:00Z", zone) }, true);
    expect(created.repeat!.skip).toEqual(["2026-03-30"]);
  });
  it("re-keys each override by its own occurrence when a time change crosses UTC midnight in one DST season", () => {
    const zone = "America/Los_Angeles";
    const start = DateTime.fromISO("2026-01-05T16:30", { zone });
    const p: CalendarEvent = {
      id: "p",
      title: "Standup",
      timestamp: 0,
      start,
      end: start.plus({ hours: 1 }),
      repeat: { interval: 1, unit: "week", overrides: { "2026-01-13": { title: "Winter" }, "2026-05-25": { title: "Summer" } }, skip: ["2026-05-18"] },
    };
    const later = start.set({ hour: 17 });
    const moved = { ...p, start: later, end: later.plus({ hours: 1 }) };

    expect(Object.keys(withShiftedOverrides(p, moved).repeat!.overrides!)).toEqual(["2026-01-13", "2026-05-26"]);
    expect(splitSeries(p, moved, false).created.repeat!.skip).toEqual(["2026-05-19"]);
  });

  it("spans an override from its occurrence start by the event duration", () => {
    const p = series("Asia/Tokyo");
    const span = overrideSpan(p, "2026-03-18", { endShift: 1800_000 });

    expect(span.end.diff(span.start).as("minutes")).toBe(90);
  });

  it("keeps the latest occurrences when every one is in the past", () => {
    const p = series("UTC", { count: 5, overrides: { "2026-03-17": { title: "Override" } } });
    const found = nearbyOccurrences(p, at("2026-04-01T00:00:00Z"), 3);

    expect(found.map((e) => e.start.toUTC().toISO())).toEqual([utcIso("18", "23"), utcIso("19", "23"), utcIso("20", "23")]);
  });
});
