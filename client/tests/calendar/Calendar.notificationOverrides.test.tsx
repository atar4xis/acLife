import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type {
  CalendarEvent,
  EventNotification,
} from "../../src/types/calendar/Event.ts";
import {
  advanceSave,
  buildRecurringEvent,
  getLastSavedEvents,
  renderCalendar,
  setupCalendarTests,
} from "./helpers";
import { seedSettings } from "../settingsStorage.ts";

setupCalendarTests();

const INSTANCE = "repeat-parent_2026-03-19";
const series: EventNotification[] = [
  { when: "minutes", amount: 5, method: "sound" },
];

type User = ReturnType<typeof renderCalendar>["user"];

const openInstance = async (user: User, key = INSTANCE) => {
  await user.dblClick(
    document.querySelector(`[data-event-key="${key}"]`) as HTMLElement,
  );
  expect(
    await screen.findByRole("heading", { name: /edit event/i }),
  ).toBeInTheDocument();
};

const addNotification = (user: User) =>
  user.click(screen.getByRole("button", { name: "Add notification" }));

const removeNotification = (user: User) =>
  user.click(screen.getByRole("button", { name: "Remove notification" }));

const saveAs = async (user: User, scope: RegExp) => {
  await user.click(screen.getByRole("button", { name: /^save$/i }));
  await user.click(await screen.findByRole("radio", { name: scope }));
  await user.click(screen.getByRole("button", { name: /^update$/i }));
  await advanceSave();
};

const parentOf = (events: CalendarEvent[]) =>
  events.find((e) => e.id === "repeat-parent")!;

const setup = (extra: Partial<CalendarEvent> = {}) => {
  const saveEvents = vi.fn();
  const view = renderCalendar({
    mode: "week",
    events: [buildRecurringEvent({ color: "#2563eb", ...extra })],
    saveEvents,
  });
  return { ...view, saveEvents };
};

describe("notification overrides on recurring events", () => {
  it("opens an instance with the notifications of the series", async () => {
    const { user } = setup({ notifications: series });

    await openInstance(user);

    expect(screen.getByRole("spinbutton", { name: "Amount" })).toHaveValue(5);
  });

  it("adds notifications to one instance without touching the series", async () => {
    const { user, saveEvents } = setup();

    await openInstance(user);
    await addNotification(user);
    await saveAs(user, /this event/i);

    const parent = parentOf(getLastSavedEvents(saveEvents));
    expect(parent.notifications).toBeUndefined();
    expect(parent.repeat?.overrides).toEqual({
      "2026-03-19": {
        startShift: 0,
        endShift: 0,
        notifications: [{ when: "start", amount: 10, method: "sound" }],
      },
    });
  });

  it("clears the notifications of one instance", async () => {
    const { user, saveEvents } = setup({ notifications: series });

    await openInstance(user);
    await removeNotification(user);
    await saveAs(user, /this event/i);

    const parent = parentOf(getLastSavedEvents(saveEvents));
    expect(parent.notifications).toEqual(series);
    expect(parent.repeat?.overrides?.["2026-03-19"].notifications).toEqual([]);
  });

  it("drops the override once the instance matches the series again", async () => {
    const { user, saveEvents } = setup({
      notifications: series,
      repeat: {
        interval: 1,
        unit: "day",
        overrides: { "2026-03-19": { notifications: [] } },
      },
    });

    await openInstance(user);
    await addNotification(user);
    await user.click(screen.getByRole("combobox", { name: "When to notify" }));
    await user.click(
      await screen.findByRole("option", { name: "Minutes before the event" }),
    );
    const amount = screen.getByRole("spinbutton", { name: "Amount" });
    await user.clear(amount);
    await user.type(amount, "5");
    await saveAs(user, /this event/i);

    expect(parentOf(getLastSavedEvents(saveEvents)).repeat?.overrides).toBe(
      undefined,
    );
  });

  it("changes the notifications of the whole series", async () => {
    const { user, saveEvents } = setup({ notifications: series });

    await openInstance(user);
    await removeNotification(user);
    await saveAs(user, /all events/i);

    const parent = parentOf(getLastSavedEvents(saveEvents));
    expect(parent.notifications).toBeUndefined();
    expect(parent.repeat?.overrides).toBeUndefined();
  });

  it("keeps the notifications of an instance that detaches", async () => {
    seedSettings({ detachRecurringOnEdit: true });
    const { user, saveEvents } = setup();

    await openInstance(user);
    await addNotification(user);
    await saveAs(user, /this event/i);

    const saved = getLastSavedEvents(saveEvents);
    const detached = saved.find((e) => e.id !== "repeat-parent")!;
    expect(detached.notifications).toEqual([
      { when: "start", amount: 10, method: "sound" },
    ]);
    expect(parentOf(saved).notifications).toBeUndefined();
  });
});
