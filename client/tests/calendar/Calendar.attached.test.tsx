import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
import {
  FIXED_NOW,
  advanceSave,
  buildRecurringEvent,
  ctrlClickEvent,
  dayCenterX,
  dragEvent,
  getLastSavedEvents,
  openEventEditor,
  openEventMenu,
  pickCalendarDate,
  renderCalendar,
  setupCalendarTests,
  timeToClientY,
} from "./helpers";
import { focusGrid } from "./gridKeyboardHelpers";
import { seedSettings } from "../settingsStorage.ts";

setupCalendarTests();

const week = FIXED_NOW.startOf("week");
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const startedLastWeek = (extra: Partial<CalendarEvent> = {}) =>
  buildRecurringEvent({
    start: week.minus({ days: 7 }).plus({ hours: 8 }),
    end: week.minus({ days: 7 }).plus({ hours: 9 }),
    ...extra,
  });

const weeklyEarlier = () =>
  startedLastWeek({
    start: week.minus({ days: 5 }).plus({ hours: 8 }),
    end: week.minus({ days: 5 }).plus({ hours: 9 }),
    repeat: { interval: 1, unit: "week" },
  });

const parentOf = (events: CalendarEvent[], id = "repeat-parent") =>
  events.find((e) => e.id === id)!;

const openInstance = async (
  user: ReturnType<typeof renderCalendar>["user"],
  key: string,
) => {
  await user.dblClick(
    document.querySelector(`[data-event-key="${key}"]`) as HTMLElement,
  );
  expect(
    await screen.findByRole("heading", { name: /edit event/i }),
  ).toBeInTheDocument();
};

const chooseRepeat = async (
  user: ReturnType<typeof renderCalendar>["user"],
  name: RegExp,
) => {
  await user.click(screen.getByRole("combobox", { name: /repeat/i }));
  await user.click(await screen.findByRole("option", { name }));
};

const save = (user: ReturnType<typeof renderCalendar>["user"]) =>
  user.click(screen.getByRole("button", { name: /^save$/i }));

const confirm = async (
  user: ReturnType<typeof renderCalendar>["user"],
  option: RegExp,
) => {
  await user.click(await screen.findByRole("radio", { name: option }));
  await user.click(screen.getByRole("button", { name: /^update$/i }));
  await advanceSave();
};

const warning = /will detach this event from the series/i;

describe("attached recurring instances", () => {
  it("keeps a dragged instance attached", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [weeklyEarlier()],
      saveEvents,
    });

    await dragEvent({
      title: "Daily standup",
      startX: dayCenterX(2),
      startY: timeToClientY(8),
      endX: dayCenterX(2),
      endY: timeToClientY(10),
    });
    await confirm(user, /this event/i);

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(saved[0].repeat?.overrides).toEqual({
      "2026-03-18": { startShift: 2 * HOUR, endShift: 2 * HOUR },
    });
  });

  it("detaches a dragged instance when the setting is on", async () => {
    seedSettings({ detachRecurringOnEdit: true });
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [weeklyEarlier()],
      saveEvents,
    });

    await dragEvent({
      title: "Daily standup",
      startX: dayCenterX(2),
      startY: timeToClientY(8),
      endX: dayCenterX(2),
      endY: timeToClientY(10),
    });
    await confirm(user, /this event/i);

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(2);
    expect(parentOf(saved).repeat?.overrides).toBeUndefined();
  });

  it("stores an editor change against the original date", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openInstance(user, "repeat-parent_2026-03-19");
    const [startDate, endDate] = screen.getAllByRole("button", {
      name: "19 Mar 2026",
    });
    const target = FIXED_NOW.startOf("day").plus({ days: 3 });
    await pickCalendarDate(user, startDate, target);
    await pickCalendarDate(user, endDate, target);
    await save(user);
    await confirm(user, /this event/i);

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(saved[0].repeat?.overrides).toMatchObject({
      "2026-03-19": { startShift: 2 * DAY, endShift: 2 * DAY },
    });
  });

  it("promotes the next instance when the parent is edited", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Daily standup");
    const title = screen.getByDisplayValue("Daily standup");
    await user.clear(title);
    await user.type(title, "Kickoff");
    await save(user);
    await confirm(user, /this event/i);

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe("Daily standup");
    expect(saved[0].start.toISO()).toBe(
      week.plus({ days: 3, hours: 8 }).toISO(),
    );
    expect(saved[0].repeat?.overrides).toMatchObject({
      "2026-03-18": { title: "Kickoff", startShift: 0, endShift: 0 },
    });
    expect(await screen.findByText("Kickoff")).toBeInTheDocument();
  });

  it("keys the promoted parent's override by its original date", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Daily standup");
    const [startDate, endDate] = screen.getAllByRole("button", {
      name: "18 Mar 2026",
    });
    const target = FIXED_NOW.startOf("day").plus({ days: 3 });
    await pickCalendarDate(user, startDate, target);
    await pickCalendarDate(user, endDate, target);
    await save(user);
    await confirm(user, /this event/i);

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(saved[0].repeat?.overrides).toMatchObject({
      "2026-03-18": { startShift: 3 * DAY, endShift: 3 * DAY },
    });
  });

  it("keys the promoted override by the original date after keyboard open", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await screen.findByText("Daily standup");
    focusGrid();
    await user.keyboard("{Control>}{ArrowUp}{/Control}{Enter}{Enter}");
    expect(await screen.findByRole("dialog", { name: "Edit event" })).toBeVisible();
    const [startDate, endDate] = screen.getAllByRole("button", {
      name: "18 Mar 2026",
    });
    const target = FIXED_NOW.startOf("day").plus({ days: 3 });
    await pickCalendarDate(user, startDate, target);
    await pickCalendarDate(user, endDate, target);
    await save(user);
    await confirm(user, /this event/i);

    expect(
      Object.keys(getLastSavedEvents(saveEvents)[0].repeat!.overrides!),
    ).toEqual(["2026-03-18"]);
  });

  it("skips the original date when a moved instance detaches", async () => {
    seedSettings({ detachRecurringOnEdit: true });
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openInstance(user, "repeat-parent_2026-03-19");
    const [startDate, endDate] = screen.getAllByRole("button", {
      name: "19 Mar 2026",
    });
    const target = FIXED_NOW.startOf("day").plus({ days: 3 });
    await pickCalendarDate(user, startDate, target);
    await pickCalendarDate(user, endDate, target);
    await save(user);
    await confirm(user, /this event/i);

    expect(parentOf(getLastSavedEvents(saveEvents)).repeat?.skip).toEqual([
      "2026-03-19",
    ]);
  });

  const cutSeries = () =>
    buildRecurringEvent({
      color: "#2563eb",
      repeat: {
        interval: 1,
        unit: "day",
        until: week.plus({ days: 3 }).toMillis(),
      },
    });

  it("applies a parent's repeat change to the series with 'this event'", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [cutSeries()],
      saveEvents,
    });

    await openEventEditor(user, "Daily standup");
    await chooseRepeat(user, /repeat daily$/i);
    await save(user);
    await confirm(user, /this event/i);

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("repeat-parent");
    expect(saved[0].start.toISO()).toBe(
      week.plus({ days: 2, hours: 8 }).toISO(),
    );
    expect(saved[0].repeat).toEqual({ interval: 1, unit: "day" });
  });

  it("keeps a parent's own edit to this occurrence when its repeat changes too", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [cutSeries()],
      saveEvents,
    });

    await openEventEditor(user, "Daily standup");
    await user.type(screen.getByDisplayValue("Daily standup"), "!");
    await chooseRepeat(user, /repeat daily$/i);
    await save(user);
    await confirm(user, /this event/i);

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe("Daily standup");
    expect(saved[0].start.toISODate()).toBe("2026-03-19");
    expect(saved[0].repeat?.until).toBeUndefined();
    expect(saved[0].repeat?.overrides).toMatchObject({
      "2026-03-18": { title: "Daily standup!" },
    });
  });

  it("detaches an instance when its repeat changes", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openInstance(user, "repeat-parent_2026-03-19");
    await chooseRepeat(user, /weekly/i);
    await save(user);
    await confirm(user, /this event/i);

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(2);
    expect(parentOf(saved).repeat?.skip).toEqual(["2026-03-19"]);
  });

  it("moves overrides with the parent date on 'all events'", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildRecurringEvent({
          repeat: {
            interval: 1,
            unit: "day",
            overrides: { "2026-03-20": { title: "Retro" } },
          },
        }),
      ],
      saveEvents,
    });

    await openEventEditor(user, "Daily standup");
    const [startDate, endDate] = screen.getAllByRole("button", {
      name: "18 Mar 2026",
    });
    const target = FIXED_NOW.startOf("day").plus({ days: 1 });
    await pickCalendarDate(user, startDate, target);
    await pickCalendarDate(user, endDate, target);
    await save(user);
    await confirm(user, /future events/i);

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0].repeat!.overrides!)).toEqual(["2026-03-21"]);
  });

  const laterOverride = () =>
    buildRecurringEvent({
      repeat: {
        interval: 1,
        unit: "day",
        overrides: { "2026-03-21": { title: "Retro" } },
      },
    });

  const futureEdit = async (
    user: ReturnType<typeof renderCalendar>["user"],
    keep: boolean,
  ) => {
    await openInstance(user, "repeat-parent_2026-03-19");
    const title = screen.getByDisplayValue("Daily standup");
    await user.clear(title);
    await user.type(title, "Team standup");
    await save(user);
    await user.click(await screen.findByRole("radio", { name: /future/i }));
    const box = screen.getByRole("checkbox", { name: /keep changes to future events/i });
    if (keep) await user.click(box);
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();
  };

  it("keeps later overrides in a 'future' series when asked", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [laterOverride()],
      saveEvents,
    });

    await futureEdit(user, true);

    const created = getLastSavedEvents(saveEvents).find(
      (e) => e.id !== "repeat-parent",
    )!;
    expect(created.repeat?.overrides).toEqual({
      "2026-03-21": { title: "Retro" },
    });
  });

  it("drops later overrides in a 'future' series when unchecked", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [laterOverride()],
      saveEvents,
    });

    await futureEdit(user, false);

    const created = getLastSavedEvents(saveEvents).find(
      (e) => e.id !== "repeat-parent",
    )!;
    expect(created.repeat?.overrides).toBeUndefined();
    expect(
      parentOf(getLastSavedEvents(saveEvents)).repeat?.overrides,
    ).toBeUndefined();
  });

  it("only offers keeping changes for 'future' when later overrides exist", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
    });

    await openInstance(user, "repeat-parent_2026-03-19");
    const title = screen.getByDisplayValue("Daily standup");
    await user.type(title, "!");
    await save(user);
    await user.click(await screen.findByRole("radio", { name: /future/i }));

    expect(screen.queryByRole("checkbox", { name: /keep changes to future events/i })).toBeNull();
  });

  it("hides keeping changes unless 'future' is chosen", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [laterOverride()],
    });

    await openInstance(user, "repeat-parent_2026-03-19");
    await user.type(screen.getByDisplayValue("Daily standup"), "!");
    await save(user);
    await screen.findByRole("radio", { name: /this event/i });

    expect(screen.queryByRole("checkbox", { name: /keep changes to future events/i })).toBeNull();
    await user.click(screen.getByRole("radio", { name: /future/i }));
    expect(
      screen.getByRole("checkbox", { name: /keep changes to future events/i }),
    ).not.toBeChecked();
  });

  it("detaches every selected instance when the repeat changes", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [
        startedLastWeek(),
        startedLastWeek({ id: "repeat-parent-2", title: "Weekly sync" }),
      ],
      saveEvents,
    });

    await ctrlClickEvent("Daily standup");
    await ctrlClickEvent("Weekly sync");
    await openEventEditor(user, "Daily standup");
    await chooseRepeat(user, /weekly/i);
    await save(user);
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)).toHaveLength(4);
  });
});

describe("attached instances moved without the dialog", () => {
  it("keeps selected instances attached when dragged together", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [
        weeklyEarlier(),
        { ...weeklyEarlier(), id: "repeat-parent-2", title: "Weekly sync" },
      ],
      saveEvents,
    });

    await ctrlClickEvent("Daily standup");
    await ctrlClickEvent("Weekly sync");
    await dragEvent({
      title: "Daily standup",
      startX: dayCenterX(2),
      startY: timeToClientY(8),
      endX: dayCenterX(2),
      endY: timeToClientY(10),
    });
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(2);
    expect(saved.every((e) => e.repeat?.overrides)).toBe(true);
  });

  it("keeps an instance attached when moved from the menu", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({ events: [startedLastWeek()], saveEvents });

    await openEventMenu(user, "Daily standup");
    fireEvent.click(await screen.findByRole("menuitem", { name: /move\.\.\./i }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /later\.\.\./i }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "1 hour" }));
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(Object.values(saved[0].repeat!.overrides!)).toEqual([
      { startShift: HOUR, endShift: HOUR },
    ]);
  });
});

describe("cutting a series at an instance", () => {
  const series = () =>
    buildRecurringEvent({
      repeat: {
        interval: 1,
        unit: "day",
        overrides: {
          "2026-03-18": { title: "Before" },
          "2026-03-19": { title: "Own" },
          "2026-03-21": { title: "After" },
        },
      },
    });

  it("drops overrides from the cut onwards when deleting future events", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [series()],
      saveEvents,
    });

    await user.pointer({
      target: document.querySelector(
        '[data-event-key="repeat-parent_2026-03-19"]',
      ) as HTMLElement,
      keys: "[MouseRight]",
    });
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await user.click(await screen.findByRole("radio", { name: /future/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0].repeat!.overrides!)).toEqual(["2026-03-18"]);
    expect(saved[0].repeat?.until).toBeDefined();
  });

  it("cuts at the occurrence date when deleting future events from a moved instance", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildRecurringEvent({
          repeat: {
            interval: 1,
            unit: "day",
            overrides: { "2026-03-19": { startShift: 2 * DAY, endShift: 2 * DAY } },
          },
        }),
      ],
      saveEvents,
    });

    await user.pointer({
      target: document.querySelector(
        '[data-event-key="repeat-parent_2026-03-19"]',
      ) as HTMLElement,
      keys: "[MouseRight]",
    });
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await user.click(await screen.findByRole("radio", { name: /future/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].repeat?.until).toBe(
      Date.UTC(2026, 2, 19),
    );
  });

  it("drops overrides from the cut onwards when splitting at an instance", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [series()],
      saveEvents,
    });

    await openInstance(user, "repeat-parent_2026-03-19");
    await user.type(screen.getByDisplayValue("Own"), "!");
    await save(user);
    await user.click(await screen.findByRole("radio", { name: /future/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(2);
    expect(
      Object.keys(parentOf(saved).repeat!.overrides!),
    ).toEqual(["2026-03-18"]);
  });
});

describe("cutting a series at an override left before the parent", () => {
  const promoted = () =>
    buildRecurringEvent({
      color: "#2563eb",
      repeat: {
        interval: 1,
        unit: "day",
        overrides: {
          "2026-03-16": { title: "Early" },
          "2026-03-17": { title: "Cut" },
        },
      },
    });
  const cutBlock = () =>
    document.querySelector(
      '[data-event-key="repeat-parent_2026-03-17"]',
    ) as HTMLElement;

  it("deletes the parent too when deleting future events", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [promoted()],
      saveEvents,
    });

    await user.pointer({ target: cutBlock(), keys: "[MouseRight]" });
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await user.click(await screen.findByRole("radio", { name: /future/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved.map((e) => e.title)).toEqual(["Early"]);
    expect(saved[0].repeat).toBeUndefined();
    expect(saved[0].start.toISODate()).toBe("2026-03-16");
  });

  it("replaces the parent when updating future events", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [promoted()],
      saveEvents,
    });

    await openInstance(user, "repeat-parent_2026-03-17");
    await user.type(screen.getByDisplayValue("Cut"), "!");
    await save(user);
    await user.click(await screen.findByRole("radio", { name: /future/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved.find((e) => e.id === "repeat-parent")).toBeUndefined();
    expect(saved.filter((e) => e.repeat)).toHaveLength(1);
    expect(saved.find((e) => !e.repeat)?.title).toBe("Early");
  });
});

describe("resetting an overridden instance", () => {
  const overridden = () =>
    buildRecurringEvent({
      repeat: {
        interval: 1,
        unit: "day",
        overrides: {
          "2026-03-19": { title: "Retro" },
          "2026-03-20": { title: "Other" },
        },
      },
    });

  const resetItem = () =>
    screen.queryByRole("menuitem", { name: /reset to original event/i });

  it("removes the override from the context menu", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [overridden()],
      saveEvents,
    });

    await user.pointer({
      target: document.querySelector(
        '[data-event-key="repeat-parent_2026-03-19"]',
      ) as HTMLElement,
      keys: "[MouseRight]",
    });
    await user.click(
      await screen.findByRole("menuitem", { name: /reset to original event/i }),
    );
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0].repeat!.overrides!)).toEqual(["2026-03-20"]);
    expect(
      document.querySelector('[data-event-key="repeat-parent_2026-03-19"]')
        ?.textContent,
    ).toContain("Daily standup");
  });

  it("is not offered on instances without an override", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [overridden()],
    });

    await user.pointer({
      target: document.querySelector(
        '[data-event-key="repeat-parent_2026-03-21"]',
      ) as HTMLElement,
      keys: "[MouseRight]",
    });
    await screen.findByRole("menuitem", { name: /detach from parent/i });

    expect(resetItem()).toBeNull();
  });

  it("is not offered on the parent", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [overridden()],
    });

    await openEventMenu(user, "Daily standup");
    await screen.findByRole("menuitem", { name: /duplicate/i });

    expect(resetItem()).toBeNull();
  });

  it("restores the parent when resetting an override left before its start", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildRecurringEvent({
          repeat: {
            interval: 1,
            unit: "day",
            overrides: { "2026-03-17": { title: "Old" } },
          },
        }),
      ],
      saveEvents,
    });

    await openEventMenu(user, "Old");
    await user.click(
      await screen.findByRole("menuitem", { name: /reset to original event/i }),
    );
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(saved[0].start.toISODate()).toBe("2026-03-17");
    expect(saved[0].repeat?.overrides).toBeUndefined();
  });

  it("removes the override from the editor menu", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [overridden()],
      saveEvents,
    });

    await openInstance(user, "repeat-parent_2026-03-19");
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /reset to original event/i }),
    );
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0].repeat!.overrides!)).toEqual(["2026-03-20"]);
    expect(saved[0].repeat?.skip).toBeUndefined();
  });

  it("hides the editor menu entry without an override", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [overridden()],
    });

    await openInstance(user, "repeat-parent_2026-03-21");
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await screen.findByRole("menuitem", { name: /detach from parent/i });

    expect(resetItem()).toBeNull();
  });
});

describe("batch edits of recurring events", () => {
  const colored = (extra: Partial<CalendarEvent> = {}) =>
    startedLastWeek({ color: "#2563eb", ...extra });

  it("keeps selected instances attached when only the title changes", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [
        colored(),
        colored({ id: "repeat-parent-2", title: "Weekly sync" }),
      ],
      saveEvents,
    });

    await ctrlClickEvent("Daily standup");
    await ctrlClickEvent("Weekly sync");
    await openEventEditor(user, "Daily standup");
    await user.type(screen.getByDisplayValue("Daily standup"), "!");
    await save(user);
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(2);
    expect(saved.every((e) => e.repeat?.overrides)).toBe(true);
  });

  it("applies a repeat change to selected parents instead of detaching them", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildRecurringEvent({ color: "#2563eb" }),
        buildRecurringEvent({
          id: "repeat-parent-2",
          title: "Weekly sync",
          color: "#2563eb",
          start: week.plus({ days: 2, hours: 14 }),
          end: week.plus({ days: 2, hours: 15 }),
        }),
      ],
      saveEvents,
    });

    await ctrlClickEvent("Daily standup");
    await ctrlClickEvent("Weekly sync");
    await openEventEditor(user, "Daily standup");
    await chooseRepeat(user, /repeat weekly$/i);
    await save(user);
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(2);
    expect(saved.every((e) => e.repeat?.unit === "week")).toBe(true);
  });
});

describe("attached instance menus", () => {
  it("detaches from the editor menu", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openInstance(user, "repeat-parent_2026-03-19");
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /detach from parent/i }),
    );
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents);
    expect(saved).toHaveLength(2);
    expect(parentOf(saved).repeat?.skip).toEqual(["2026-03-19"]);
  });

  it("hides editor detach on the parent", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
    });

    await openEventEditor(user, "Daily standup");
    await user.click(screen.getByRole("button", { name: /more actions/i }));
    await screen.findByRole("menuitem", { name: /copy/i });
    expect(
      screen.queryByRole("menuitem", { name: /detach from parent/i }),
    ).toBeNull();
  });

  it("never offers keeping changes when the parent is edited", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildRecurringEvent({
          repeat: { interval: 1, unit: "day", overrides: { "2026-03-21": { title: "Retro" } } },
        }),
      ],
    });

    await openEventEditor(user, "Daily standup");
    await user.type(screen.getByDisplayValue("Daily standup"), "!");
    await save(user);
    await user.click(await screen.findByRole("radio", { name: /future/i }));

    expect(screen.queryByRole("checkbox", { name: /keep changes to future events/i })).toBeNull();
  });

  it("moves the parent's end date when an instance's end date changes for 'all events'", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await user.pointer({
      target: document.querySelector('[data-event-key="repeat-parent_2026-03-19"]') as HTMLElement,
      keys: "[MouseRight]",
    });
    await user.click(await screen.findByRole("menuitem", { name: /^edit$/i }));
    const [, endDate] = await screen.findAllByRole("button", { name: "19 Mar 2026" });
    await pickCalendarDate(user, endDate, FIXED_NOW.startOf("day").plus({ days: 2 }));
    await save(user);
    await confirm(user, /all events/i);

    const saved = parentOf(getLastSavedEvents(saveEvents));
    expect(saved.start.toISODate()).toBe("2026-03-18");
    expect(saved.end.toISODate()).toBe("2026-03-19");
  });

  it("shows the repeat warning on an attached instance", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
    });

    await openInstance(user, "repeat-parent_2026-03-19");
    expect(screen.queryByText(warning)).toBeNull();
    await chooseRepeat(user, /weekly/i);
    expect(
      screen.getByText("Changing repeat settings will detach this event from the series."),
    ).toBeInTheDocument();
  });

  it("offers detaching on instances only", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
    });

    await openEventMenu(user, "Daily standup");
    expect(screen.queryByRole("menuitem", { name: /detach from parent/i })).toBeNull();
  });

  it("warns about repeat changes only on instances while attached", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
    });

    await openEventEditor(user, "Daily standup");
    await chooseRepeat(user, /weekly/i);
    expect(screen.queryByText(warning)).toBeNull();
  });

  it("does not warn when the setting detaches on every edit", async () => {
    seedSettings({ detachRecurringOnEdit: true });
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
    });

    await openInstance(user, "repeat-parent_2026-03-19");
    await chooseRepeat(user, /weekly/i);
    expect(screen.queryByText(warning)).toBeNull();
  });
});
