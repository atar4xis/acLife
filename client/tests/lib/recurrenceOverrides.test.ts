import { describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import type {
  CalendarEvent,
  OccurrenceOverride,
} from "@/types/calendar/Event";
import { makeOccurrence } from "@/lib/calendar/event";
import {
  detachSingleOccurrence,
  endSeriesBefore,
  cutPoint,
  futureOverrides,
  nearbyOccurrences,
  resetOccurrence,
  splitSeries,
  overrideOccurrences,
  overridesBefore,
  shiftOverrides,
  skipSingleOccurrence,
} from "@/lib/calendar/recurrence";

const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

const parent: CalendarEvent = {
  id: "p",
  title: "Standup",
  start: at("2026-01-01T09:00"),
  end: at("2026-01-01T10:00"),
  repeat: { interval: 1, unit: "day" },
  timestamp: 0,
};

const instance = (p: CalendarEvent, key: string) =>
  makeOccurrence(p, at(`${key}T${p.start.toFormat("HH:mm")}`), key, p.end.diff(p.start));

const edit = (p: CalendarEvent, key: string, patch: Partial<CalendarEvent>) => {
  const original = instance(p, key);
  const dispatch = vi.fn();
  const updateChange = vi.fn();
  const result = detachSingleOccurrence(
    { ...original, ...patch },
    original.start,
    [p],
    dispatch,
    updateChange,
    false,
  );
  return { result: result!, dispatch, updateChange };
};

describe("attached recurring instances", () => {
  it("stores the edit as an override on the parent without adding events", () => {
    const { result, dispatch } = edit(parent, "2026-01-03", {
      title: "Retro",
      start: at("2026-01-03T15:00"),
      end: at("2026-01-03T16:30"),
    });

    expect(result.repeat?.overrides).toEqual({
      "2026-01-03": {
        title: "Retro",
        startShift: 6 * 3600_000,
        endShift: 6.5 * 3600_000,
      },
    });
    expect(result.repeat?.skip).toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].type).toBe("update");
  });

  it("keeps its offset when the parent moves and follows parent renames", () => {
    const { result } = edit(parent, "2026-01-03", {
      start: at("2026-01-03T15:00"),
      end: at("2026-01-03T16:00"),
    });
    const moved = {
      ...result,
      title: "Daily sync",
      start: result.start.plus({ hours: 1 }),
      end: result.end.plus({ hours: 1 }),
    };
    const child = instance(moved, "2026-01-03");

    expect(child.start.toISO()).toBe(at("2026-01-03T16:00").toISO());
    expect(child.title).toBe("Daily sync");
  });

  it("keeps an own title over parent renames", () => {
    const { result } = edit(parent, "2026-01-03", { title: "Retro" });
    const child = instance({ ...result, title: "Daily sync" }, "2026-01-03");

    expect(child.title).toBe("Retro");
  });

  it("drops the override when the edit matches the parent again", () => {
    const first = edit(parent, "2026-01-03", { title: "Retro" }).result;
    const { result } = edit(first, "2026-01-03", { title: "Standup" });

    expect(result.repeat?.overrides).toBeUndefined();
  });

  it("skips the nominal date and clears the override when deleted", () => {
    const first = edit(parent, "2026-01-03", {
      start: at("2026-01-04T09:00"),
      end: at("2026-01-04T10:00"),
    }).result;
    const child = instance(first, "2026-01-03");
    const result = skipSingleOccurrence(child, [first], vi.fn(), vi.fn());

    expect(result?.repeat?.skip).toEqual(["2026-01-03"]);
    expect(result?.repeat?.overrides).toBeUndefined();
  });

  it("detaches into a standalone event with the shown values", () => {
    const first = edit(parent, "2026-01-03", {
      title: "Retro",
      start: at("2026-01-03T15:00"),
      end: at("2026-01-03T16:00"),
    }).result;
    const child = instance(first, "2026-01-03");
    const dispatch = vi.fn();
    const result = detachSingleOccurrence(
      child,
      child.start,
      [first],
      dispatch,
      vi.fn(),
    );
    const added = dispatch.mock.calls.find((c) => c[0].type === "add")![0].event;

    expect(added.title).toBe("Retro");
    expect(added.start.toISO()).toBe(at("2026-01-03T15:00").toISO());
    expect(added._parent).toBeUndefined();
    expect(added.repeat).toBeUndefined();
    expect(result?.repeat?.skip).toEqual(["2026-01-03"]);
    expect(result?.repeat?.overrides).toBeUndefined();
  });

  it("moves override keys with the parent date", () => {
    const { result } = edit(parent, "2026-01-03", { title: "Retro" });

    expect(Object.keys(shiftOverrides(result.repeat!.overrides, () => "2026-01-04")!)).toEqual([
      "2026-01-04",
    ]);
  });
});

describe("editing the parent while attached", () => {
  const editParent = (p: CalendarEvent, patch: Partial<CalendarEvent>) => {
    const dispatch = vi.fn();
    const result = detachSingleOccurrence(
      { ...p, ...patch },
      p.start,
      [p],
      dispatch,
      vi.fn(),
      false,
    );
    return { result, dispatch };
  };

  it("promotes the next instance and keeps the old parent as an override", () => {
    const { result, dispatch } = editParent(parent, { title: "Kickoff" });

    expect(result?.start.toISO()).toBe(at("2026-01-02T09:00").toISO());
    expect(result?.title).toBe("Standup");
    expect(result?.repeat?.overrides).toEqual({
      "2026-01-01": { title: "Kickoff", startShift: 0, endShift: 0 },
    });
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(["update"]);

    const old = makeOccurrence(
      result!,
      at("2026-01-01T09:00"),
      "2026-01-01",
      result!.end.diff(result!.start),
    );
    expect(old.title).toBe("Kickoff");
  });

  it("keeps the series count by counting the override", () => {
    const { result } = editParent(
      { ...parent, repeat: { interval: 1, unit: "day", count: 3 } },
      { title: "Kickoff" },
    );

    expect(result?.repeat?.count).toBe(2);
  });

  it("skips a next instance that has its own override", () => {
    const withChild = edit(parent, "2026-01-02", { title: "Retro" }).result;
    const { result } = editParent(withChild, { title: "Kickoff" });

    expect(result?.start.toISO()).toBe(at("2026-01-03T09:00").toISO());
    expect(Object.keys(result!.repeat!.overrides!).sort()).toEqual([
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("keeps remaining instances as events when no next instance exists", () => {
    const single: CalendarEvent = {
      ...parent,
      repeat: {
        interval: 1,
        unit: "day",
        count: 1,
        overrides: { "2025-12-31": { title: "Earlier" } },
      },
    };
    const { result, dispatch } = editParent(single, { title: "Solo" });
    const added = dispatch.mock.calls
      .filter((c) => c[0].type === "add")
      .map((c) => c[0].event.title);

    expect(result).toBeUndefined();
    expect(added.sort()).toEqual(["Earlier", "Solo"]);
  });
});

describe("detaching a shifted instance", () => {
  it("skips the nominal date when the instance moved to another day", () => {
    const first = edit(parent, "2026-01-03", {
      start: at("2026-01-05T09:00"),
      end: at("2026-01-05T10:00"),
    }).result;
    const child = instance(first, "2026-01-03");
    const result = detachSingleOccurrence(
      child,
      child.start,
      [first],
      vi.fn(),
      vi.fn(),
    );

    expect(result?.repeat?.skip).toEqual(["2026-01-03"]);
  });

  it("leaves no instance-only state on the detached event", () => {
    const edited = edit(parent, "2026-01-03", { title: "Retro" }).result;
    const child = instance(edited, "2026-01-03");
    const dispatch = vi.fn();
    detachSingleOccurrence(child, child.start, [edited], dispatch, vi.fn());

    const added = dispatch.mock.calls.find((c) => c[0].type === "add")![0].event;
    expect(added._resettable).toBeUndefined();
    expect(added._overrideKey).toBeUndefined();
  });

  it("detaches instead of attaching when asked to", () => {
    const original = instance(parent, "2026-01-03");
    const dispatch = vi.fn();
    const result = detachSingleOccurrence(
      { ...original, title: "Retro" },
      original.start,
      [parent],
      dispatch,
      vi.fn(),
      true,
    );

    expect(result?.repeat?.overrides).toBeUndefined();
    expect(dispatch.mock.calls.map((c) => c[0].type)).toContain("add");
  });
});

describe("skipping the parent", () => {
  it("promotes past an overridden next instance and keeps the count", () => {
    const counted: CalendarEvent = {
      ...parent,
      repeat: {
        interval: 1,
        unit: "day",
        count: 4,
        overrides: { "2026-01-02": { title: "Retro" } },
      },
    };
    const dispatch = vi.fn();
    const result = skipSingleOccurrence(counted, [counted], dispatch, vi.fn());

    expect(result?.start.toISO()).toBe(at("2026-01-03T09:00").toISO());
    expect(result?.repeat?.count).toBe(3);
    expect(Object.keys(result!.repeat!.overrides!)).toEqual(["2026-01-02"]);
  });
});

describe("futureOverrides", () => {
  const withLater: CalendarEvent = {
    ...parent,
    repeat: {
      interval: 1,
      unit: "day",
      overrides: {
        "2026-01-02": { title: "Earlier" },
        "2026-01-03": { title: "Own" },
        "2026-01-05": { title: "Later", startShift: 3600_000 },
      },
    },
  };

  it("keeps only overrides after the edited instance", () => {
    expect(futureOverrides(withLater, instance(withLater, "2026-01-03"))).toEqual({
      "2026-01-05": { title: "Later", startShift: 3600_000 },
    });
  });

  it("re-keys them when the edited instance moved to another day", () => {
    const moved = {
      ...instance(withLater, "2026-01-03"),
      start: at("2026-01-04T09:00"),
      end: at("2026-01-04T10:00"),
    };

    expect(Object.keys(futureOverrides(withLater, moved)!)).toEqual([
      "2026-01-06",
    ]);
  });

  it("returns nothing without later overrides", () => {
    expect(
      futureOverrides(withLater, instance(withLater, "2026-01-05")),
    ).toBeUndefined();
  });
});

describe("overrideOccurrences", () => {
  it("builds every overridden instance with its edits", () => {
    const p: CalendarEvent = {
      ...parent,
      repeat: {
        interval: 1,
        unit: "day",
        overrides: { "2025-12-30": { title: "Before" } },
      },
    };
    const [early] = overrideOccurrences(p);

    expect(early.title).toBe("Before");
    expect(early._instanceId).toBe("p_2025-12-30");
    expect(early.start.toISO()).toBe(at("2025-12-30T09:00").toISO());
  });
});

describe("nearbyOccurrences with overrides", () => {
  const now = at("2026-01-10T08:00");
  const daily = (
    overrides: Record<string, OccurrenceOverride>,
  ): CalendarEvent => ({
    ...parent,
    start: at("2026-01-10T09:00"),
    end: at("2026-01-10T10:00"),
    repeat: { interval: 1, unit: "day", overrides },
  });
  const ids = (e: CalendarEvent[]) => e.map((o) => o._instanceId ?? o.id);

  it("caps results to perSide on each side of now", () => {
    const overrides = Object.fromEntries(
      ["01", "02", "03", "04", "05"].map((d) => [`2026-01-${d}`, { title: "Old" }]),
    );
    const found = nearbyOccurrences(daily(overrides), now, 2);

    expect(ids(found).filter((id) => id !== "p" && id < "p_2026-01-10")).toHaveLength(2);
  });

  it("includes an override left before the anchor", () => {
    const found = nearbyOccurrences(daily({ "2026-01-09": { title: "Old" } }), now, 3);

    expect(ids(found)).toContain("p_2026-01-09");
    expect(found.find((o) => o._instanceId === "p_2026-01-09")?.title).toBe("Old");
  });

  it("still returns at most the requested number per side", () => {
    const found = nearbyOccurrences(
      daily({
        "2026-01-09": { title: "A" },
        "2026-01-08": { title: "B" },
        "2026-01-07": { title: "C" },
        "2026-01-06": { title: "D" },
      }),
      now,
      2,
    );

    expect(
      found.filter((o) => o.start < now).map((o) => o._instanceId),
    ).toEqual(["p_2026-01-08", "p_2026-01-09"]);
    expect(found).toHaveLength(4);
  });

  it("caps the later side too when overrides sit far ahead", () => {
    const found = nearbyOccurrences(
      daily({
        "2026-01-20": { title: "A" },
        "2026-01-21": { title: "B" },
        "2026-01-22": { title: "C" },
      }),
      now,
      1,
    );

    expect(ids(found)).toEqual(["p"]);
  });

  it("places a moved override by its shown time", () => {
    const found = nearbyOccurrences(
      daily({ "2026-01-11": { startShift: -3 * 24 * 3600_000, endShift: -3 * 24 * 3600_000 } }),
      now,
      1,
    );

    const moved = found.find((o) => o._instanceId === "p_2026-01-11");
    expect(moved?.start.toISO()).toBe(at("2026-01-08T09:00").toISO());
  });
});

describe("resetOccurrence", () => {
  const withOverride: CalendarEvent = {
    ...parent,
    repeat: {
      interval: 1,
      unit: "day",
      overrides: {
        "2026-01-03": { title: "Retro" },
        "2026-01-04": { title: "Other" },
      },
    },
  };

  it("removes only that instance's override", () => {
    const dispatch = vi.fn();
    const updateChange = vi.fn();
    resetOccurrence(
      instance(withOverride, "2026-01-03"),
      [withOverride],
      dispatch,
      updateChange,
    );

    const saved = dispatch.mock.calls[0][0].data;
    expect(Object.keys(saved.repeat.overrides)).toEqual(["2026-01-04"]);
    expect(updateChange).toHaveBeenCalledTimes(1);
  });

  it("drops the overrides map once empty", () => {
    const single = {
      ...withOverride,
      repeat: { ...withOverride.repeat!, overrides: { "2026-01-03": { title: "Retro" } } },
    };
    const dispatch = vi.fn();
    resetOccurrence(instance(single, "2026-01-03"), [single], dispatch, vi.fn());

    expect(dispatch.mock.calls[0][0].data.repeat.overrides).toBeUndefined();
  });

  it("does nothing without a parent", () => {
    const dispatch = vi.fn();
    resetOccurrence(instance(withOverride, "2026-01-03"), [], dispatch, vi.fn());

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("marks only overridden instances as resettable", () => {
    expect(instance(withOverride, "2026-01-03")._resettable).toBe(true);
    expect(instance(withOverride, "2026-01-05")._resettable).toBeUndefined();
  });

  describe("an override left before the parent's start", () => {
    const promoted = (extra: object = {}): CalendarEvent => ({
      ...parent,
      start: at("2026-01-03T09:00"),
      end: at("2026-01-03T10:00"),
      repeat: {
        interval: 1,
        unit: "day",
        overrides: {
          "2026-01-01": { title: "First" },
          "2026-01-02": { title: "Second" },
        },
        ...extra,
      },
    });
    const reset = (p: CalendarEvent, key: string) => {
      const dispatch = vi.fn();
      resetOccurrence(instance(p, key), [p], dispatch, vi.fn());
      return dispatch.mock.calls[0][0].data as CalendarEvent;
    };

    it("moves the parent back to that occurrence", () => {
      const saved = reset(promoted(), "2026-01-01");

      expect(saved.start.toISO()).toBe(at("2026-01-01T09:00").toISO());
      expect(saved.end.toISO()).toBe(at("2026-01-01T10:00").toISO());
      expect(Object.keys(saved.repeat!.overrides!)).toEqual(["2026-01-02"]);
      expect(saved.repeat?.skip).toBeUndefined();
    });

    it("counts every restored occurrence even when the count is small", () => {
      const saved = reset(promoted({ count: 1 }), "2026-01-01");

      expect(saved.repeat?.count).toBe(3);
      expect(saved.repeat?.skip).toBeUndefined();
    });

    it("keeps the dates the parent already skipped", () => {
      const saved = reset(
        promoted({ skip: ["2026-01-07"] }),
        "2026-01-01",
      );

      expect(saved.repeat?.skip).toEqual(["2026-01-07"]);
    });

    it("counts the occurrences that are generated again", () => {
      const saved = reset(promoted({ count: 2 }), "2026-01-01");

      expect(saved.repeat?.count).toBe(4);
    });

    it("restores the nearest one without touching the count of later ones", () => {
      const saved = reset(promoted({ count: 2 }), "2026-01-02");

      expect(saved.start.toISO()).toBe(at("2026-01-02T09:00").toISO());
      expect(saved.repeat?.count).toBe(3);
      expect(Object.keys(saved.repeat!.overrides!)).toEqual(["2026-01-01"]);
    });

    it("keeps dates deleted in between deleted", () => {
      const gap: CalendarEvent = {
        ...promoted({ overrides: { "2026-01-01": { title: "First" } } }),
        start: at("2026-01-03T09:00"),
        end: at("2026-01-03T10:00"),
      };
      const saved = reset(gap, "2026-01-01");

      expect(saved.repeat?.skip).toEqual(["2026-01-02"]);
      expect(saved.repeat?.count).toBeUndefined();
    });

    it("only removes the override when that date is no longer in the series", () => {
      const saved = reset(
        promoted({ except: [at("2026-01-01").weekday] }),
        "2026-01-01",
      );

      expect(saved.start.toISO()).toBe(at("2026-01-03T09:00").toISO());
      expect(Object.keys(saved.repeat!.overrides!)).toEqual(["2026-01-02"]);
    });

    it("ignores an until before the restored date", () => {
      const saved = reset(
        promoted({ until: at("2026-01-04T00:00").toMillis(), count: undefined }),
        "2026-01-01",
      );

      expect(saved.start.toISO()).toBe(at("2026-01-01T09:00").toISO());
      expect(saved.repeat?.until).toBe(at("2026-01-04T00:00").toMillis());
    });
  });
});

describe("overridesBefore", () => {
  const p: CalendarEvent = {
    ...parent,
    repeat: {
      interval: 1,
      unit: "day",
      overrides: {
        "2026-01-02": { title: "Before" },
        "2026-01-03": { title: "Own" },
        "2026-01-04": { title: "After" },
      },
    },
  };

  it("keeps only overrides before the instance", () => {
    expect(overridesBefore(p, instance(p, "2026-01-03"))).toEqual({
      "2026-01-02": { title: "Before" },
    });
  });

  it("returns nothing when none are left", () => {
    expect(overridesBefore(p, instance(p, "2026-01-02"))).toBeUndefined();
  });
});

describe("editing the parent's repeat while attached", () => {
  const ended: CalendarEvent = {
    ...parent,
    repeat: { interval: 1, unit: "day", until: at("2026-01-02T00:00").toMillis() },
  };
  const run = (p: CalendarEvent, patch: Partial<CalendarEvent>) => {
    const dispatch = vi.fn();
    const result = detachSingleOccurrence(
      { ...p, ...patch },
      p.start,
      [p],
      dispatch,
      vi.fn(),
      false,
    );
    return { result, dispatch };
  };

  it("updates the parent in place when only the repeat changed", () => {
    const { result, dispatch } = run(ended, {
      repeat: { interval: 1, unit: "day" },
    });

    expect(result?.start.toISO()).toBe(parent.start.toISO());
    expect(result?.repeat).toEqual({ interval: 1, unit: "day", overrides: undefined });
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(["update"]);
  });

  it("updates the parent in place even when the new repeat still ends right away", () => {
    const { result, dispatch } = run(ended, {
      repeat: { interval: 2, unit: "day", until: ended.repeat!.until },
    });

    expect(result?.id).toBe("p");
    expect(result?.repeat?.interval).toBe(2);
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(["update"]);
  });

  it("keeps the existing overrides when the repeat is replaced", () => {
    const withOverride: CalendarEvent = {
      ...ended,
      repeat: { ...ended.repeat!, overrides: { "2026-01-05": { title: "Kept" } } },
    };
    const { result } = run(withOverride, { repeat: { interval: 2, unit: "day" } });

    expect(result?.repeat?.interval).toBe(2);
    expect(result?.repeat?.overrides).toEqual({ "2026-01-05": { title: "Kept" } });
  });

  it("promotes using the new repeat when the occurrence is edited too", () => {
    const { result } = run(ended, {
      title: "Kickoff",
      repeat: { interval: 1, unit: "day" },
    });

    expect(result?.start.toISO()).toBe(at("2026-01-02T09:00").toISO());
    expect(result?.repeat?.until).toBeUndefined();
    expect(result?.repeat?.overrides).toMatchObject({
      "2026-01-01": { title: "Kickoff" },
    });
  });

  it("still detaches when detaching is requested", () => {
    const dispatch = vi.fn();
    const result = detachSingleOccurrence(
      { ...ended, repeat: { interval: 1, unit: "day" } },
      ended.start,
      [ended],
      dispatch,
      vi.fn(),
      true,
    );

    expect(result).toBeUndefined();
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(["delete", "add"]);
  });
});

describe("endSeriesBefore", () => {
  const promoted: CalendarEvent = {
    ...parent,
    start: at("2026-01-05T09:00"),
    end: at("2026-01-05T10:00"),
    repeat: {
      interval: 1,
      unit: "day",
      overrides: {
        "2026-01-02": { title: "Early" },
        "2026-01-03": { title: "Cut" },
        "2026-01-08": { title: "Later" },
      },
    },
  };
  const cut = (key: string) => {
    const dispatch = vi.fn();
    const updateChange = vi.fn();
    const done = endSeriesBefore(
      promoted,
      instance(promoted, key),
      dispatch,
      updateChange,
    );
    return { done, dispatch, updateChange };
  };

  it("deletes the parent when the cut lies before its start", () => {
    const { done, dispatch, updateChange } = cut("2026-01-03");

    expect(done).toBe(true);
    expect(dispatch.mock.calls[0][0]).toEqual({ type: "delete", id: "p" });
    expect(updateChange).toHaveBeenCalledWith({ id: "p", type: "deleted" });
  });

  it("keeps only overrides before the cut as standalone events", () => {
    const { dispatch } = cut("2026-01-03");
    const added = dispatch.mock.calls
      .filter((c) => c[0].type === "add")
      .map((c) => c[0].event);

    expect(added.map((e) => e.title)).toEqual(["Early"]);
    expect(added[0].repeat).toBeUndefined();
    expect(added[0]._parent).toBeUndefined();
    expect(added[0].id).not.toBe("p");
    expect(added[0].start.toISO()).toBe(at("2026-01-02T09:00").toISO());
  });

  it("leaves a cut at or after the parent's start alone", () => {
    expect(cut("2026-01-05").done).toBe(false);
    const after = cut("2026-01-08");

    expect(after.done).toBe(false);
    expect(after.dispatch).not.toHaveBeenCalled();
  });
});

describe("splitSeries", () => {
  const series = (repeat: object, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
    ...parent,
    repeat: { interval: 1, unit: "day", ...repeat },
    ...extra,
  });
  const split = (
    p: CalendarEvent,
    key: string,
    patch: Partial<CalendarEvent> = {},
    keep = false,
  ) => splitSeries(p, { ...instance(p, key), ...patch }, keep);

  it("starts the new series at the edited instance and ends the old one before it", () => {
    const { created, remaining } = split(series({}), "2026-01-04", {
      title: "New",
    });

    expect(created.title).toBe("New");
    expect(created.start.toISO()).toBe(at("2026-01-04T09:00").toISO());
    expect(created.id).not.toBe("p");
    expect(created._parent).toBeUndefined();
    expect(created._resettable).toBeUndefined();
    expect(created._overrideKey).toBeUndefined();
    expect(created.repeat?.until).toBeUndefined();
    expect(remaining?.repeat?.until).toBe(at("2026-01-04T00:00").toMillis());
  });

  it("divides a count between the two series", () => {
    const { created, remaining } = split(series({ count: 6 }), "2026-01-04");

    expect(remaining?.repeat?.count).toBe(3);
    expect(remaining?.repeat?.until).toBeUndefined();
    expect(created.repeat?.count).toBe(3);
  });

  it("carries later skipped dates into the new series only", () => {
    const p = series({ skip: ["2026-01-02", "2026-01-06"] });
    const { created, remaining } = split(p, "2026-01-04");

    expect(created.repeat?.skip).toEqual(["2026-01-06"]);
    expect(remaining?.repeat?.skip).toEqual(["2026-01-02", "2026-01-06"]);
  });

  it("leaves skip empty when none are carried", () => {
    const { created } = split(series({ skip: ["2026-01-02"] }), "2026-01-04");

    expect(created.repeat?.skip).toBeUndefined();
  });

  it("keeps later overrides only when asked to", () => {
    const p = series({
      overrides: {
        "2026-01-02": { title: "Before" },
        "2026-01-06": { title: "After" },
      },
    });

    expect(split(p, "2026-01-04", {}, true).created.repeat?.overrides).toEqual({
      "2026-01-06": { title: "After" },
    });
    expect(split(p, "2026-01-04").created.repeat?.overrides).toBeUndefined();
    expect(split(p, "2026-01-04").remaining?.repeat?.overrides).toEqual({
      "2026-01-02": { title: "Before" },
    });
  });

  it("cuts the old series at the occurrence when the instance moved later", () => {
    const { remaining, created } = split(series({ skip: ["2026-01-05"] }), "2026-01-04", {
      start: at("2026-01-06T09:00"),
      end: at("2026-01-06T10:00"),
    });

    expect(remaining?.repeat?.until).toBe(at("2026-01-04T00:00").toMillis());
    expect(created.repeat?.skip).toEqual(["2026-01-07"]);
  });

  it("cuts the old series at the shown date when the instance moved earlier", () => {
    const { remaining } = split(series({}), "2026-01-04", {
      start: at("2026-01-02T09:00"),
      end: at("2026-01-02T10:00"),
    });

    expect(remaining?.repeat?.until).toBe(at("2026-01-02T00:00").toMillis());
  });

  it("counts by the occurrence, not by where a moved instance is shown", () => {
    const { remaining, created } = split(series({ count: 6 }), "2026-01-04", {
      start: at("2026-01-06T09:00"),
      end: at("2026-01-06T10:00"),
    });

    expect(remaining?.repeat?.count).toBe(3);
    expect(created.repeat?.count).toBe(3);
  });

  describe("from an override left before the parent's start", () => {
    const promoted = (repeat: object) =>
      series(repeat, {
        start: at("2026-01-05T09:00"),
        end: at("2026-01-05T10:00"),
      });

    it("leaves nothing of the parent", () => {
      const p = promoted({ overrides: { "2026-01-03": { title: "Cut" } } });

      expect(split(p, "2026-01-03").remaining).toBeNull();
    });

    it("keeps deleted dates in between deleted", () => {
      const p = promoted({ overrides: { "2026-01-03": { title: "Cut" } } });

      expect(split(p, "2026-01-03").created.repeat?.skip).toEqual(["2026-01-04"]);
    });

    it("counts the occurrences the new series regenerates", () => {
      const p = promoted({
        count: 3,
        overrides: {
          "2026-01-03": { title: "Cut" },
          "2026-01-04": { title: "Between" },
        },
      });
      const { created } = split(p, "2026-01-03");

      expect(created.repeat?.count).toBe(5);
      expect(created.repeat?.skip).toBeUndefined();
    });

    it("counts only the restored date when the ones in between were deleted", () => {
      const p = promoted({
        count: 3,
        overrides: { "2026-01-03": { title: "Cut" } },
      });

      expect(split(p, "2026-01-03").created.repeat?.count).toBe(4);
    });
  });
});


describe("clearing a field on an attached instance", () => {
  const styled: CalendarEvent = { ...parent, color: "#2563eb", description: "Notes" };

  it("keeps the cleared color across the series value", () => {
    const { result } = edit(styled, "2026-01-03", { color: undefined });

    expect(result.repeat?.overrides?.["2026-01-03"]).toMatchObject({ color: null });
    expect(instance(result, "2026-01-03").color).toBeUndefined();
    expect(instance(result, "2026-01-04").color).toBe("#2563eb");
  });

  it("keeps the cleared description", () => {
    const { result } = edit(styled, "2026-01-03", { description: undefined });

    expect(instance(result, "2026-01-03").description).toBeUndefined();
    expect(instance(result, "2026-01-04").description).toBe("Notes");
  });

  it("keeps an emptied title as the only change", () => {
    const { result } = edit(styled, "2026-01-03", { title: "" });

    expect(result.repeat?.overrides?.["2026-01-03"]?.title).toBe("");
    expect(instance(result, "2026-01-03").title).toBe("");
  });
});

describe("cutPoint", () => {
  const withOverride = (override: OccurrenceOverride): CalendarEvent => ({
    ...parent,
    repeat: { interval: 1, unit: "day", overrides: { "2026-01-03": override } },
  });

  it("uses the shown date when the instance moved earlier", () => {
    const p = withOverride({ startShift: -2 * 86400000, endShift: -2 * 86400000 });
    expect(cutPoint(p, instance(p, "2026-01-03")).toISODate()).toBe("2026-01-01");
  });

  it("uses the occurrence date when the instance moved later", () => {
    const p = withOverride({ startShift: 2 * 86400000, endShift: 2 * 86400000 });
    expect(cutPoint(p, instance(p, "2026-01-03")).toISODate()).toBe("2026-01-03");
  });

  it("uses the start of the day of an instance without an override", () => {
    expect(cutPoint(parent, instance(parent, "2026-01-05")).toISO()).toBe(
      at("2026-01-05T00:00").toISO(),
    );
  });
});
