import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  FIXED_NOW,
  buildRecurringEvent,
  renderCalendar,
  advanceSave,
  getLastSavedEvents,
  openEventEditor,
  openEventMenu,
  dayCenterX,
  timeToClientY,
  dragEvent,
  setupCalendarTests,
} from "./helpers";

setupCalendarTests();

describe("Calendar", () => {
  it("updates only selected recurring instance", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Daily standup");

    const titleInput = screen.getByDisplayValue("Daily standup");
    await user.clear(titleInput);
    await user.type(titleInput, "One-off standup");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByText(/update recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    expect(await screen.findByText("One-off standup")).toBeInTheDocument();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(2);

    const parentEvent = savedEvents.find(
      (event) => event.id === "repeat-parent",
    );
    const detachedEvent = savedEvents.find(
      (event) => event.id !== "repeat-parent",
    );

    expect(parentEvent?.title).toBe("Daily standup");
    expect(parentEvent?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 8 }).toISO(),
    );
    expect(parentEvent?.repeat).toEqual({ interval: 1, unit: "day" });
    expect(detachedEvent?.title).toBe("One-off standup");
    expect(detachedEvent?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 8 }).toISO(),
    );
    expect(detachedEvent?.repeat).toBeUndefined();
  });

  it("deletes one recurring instance", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventMenu(user, "Daily standup");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await advanceSave();

    expect(screen.queryByText("Daily standup")).not.toBeInTheDocument();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 8 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 9 }).toISO(),
    );
  });

  it("updates all recurring events", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventEditor(user, "Daily standup");

    const titleInput = screen.getByDisplayValue("Daily standup");
    await user.clear(titleInput);
    await user.type(titleInput, "Team standup");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByText(/update recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /all events/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    expect(screen.queryByText("Daily standup")).not.toBeInTheDocument();
    expect((await screen.findAllByText("Team standup")).length).toBeGreaterThan(
      1,
    );

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);
    expect(savedEvents[0].title).toBe("Team standup");
  });

  it("deletes all recurring events from dialog", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventMenu(user, "Daily standup");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    expect(
      await screen.findByText(/delete recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /all events/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await advanceSave();

    expect(screen.queryByText("Daily standup")).not.toBeInTheDocument();
    expect(getLastSavedEvents(saveEvents)).toHaveLength(0);
  });

  it("deletes future recurring instances from parent", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventMenu(user, "Daily standup");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    expect(
      await screen.findByText(/delete recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /future events/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(0);
  });

  it("deletes parent occurrence with 'this' skips already-skipped dates", async () => {
    const saveEvents = vi.fn();
    const parentStart = FIXED_NOW.startOf("week").plus({ days: 2, hours: 8 });
    const skipDate = parentStart.plus({ days: 1 }).toUTC().toISODate()!;

    const { user } = renderCalendar({
      mode: "week",
      events: [
        buildRecurringEvent({
          repeat: {
            interval: 1,
            unit: "day" as const,
            skip: [skipDate],
          },
        }),
      ],
      saveEvents,
    });

    await openEventMenu(user, "Daily standup");
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    expect(
      await screen.findByText(/delete recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /this event/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(1);

    const parent = savedEvents[0];
    expect(parent.id).toBe("repeat-parent");
    expect(parent.start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 4, hours: 8 }).toISO(),
    );
  });

  it("duplicate of recurring instance strips repeat fields", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openEventMenu(user, "Daily standup");
    await user.click(
      await screen.findByRole("menuitem", { name: /duplicate/i }),
    );

    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(2);

    const duplicated = savedEvents.find((e) => e.id !== "repeat-parent");
    expect(duplicated?.repeat).toBeUndefined();
    expect(duplicated?._parent).toBeUndefined();
    expect(duplicated?._instanceId).toBeUndefined();
  });

  it("cancel on recurring dialog after drag resets refs", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await dragEvent({
      title: "Daily standup",
      startX: dayCenterX(2),
      startY: timeToClientY(8),
      endX: dayCenterX(2),
      endY: timeToClientY(9),
    });

    expect(
      await screen.findByText(/update recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();

    await dragEvent({
      title: "Daily standup",
      startX: dayCenterX(2),
      startY: timeToClientY(8),
      endX: dayCenterX(4),
      endY: timeToClientY(10),
    });

    expect(
      await screen.findByText(/update recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /this event/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(2);

    const parent = savedEvents.find((e) => e.id === "repeat-parent");
    const detached = savedEvents.find((e) => e.id !== "repeat-parent");

    expect(parent?.start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 3, hours: 8 }).toISO(),
    );
    expect(detached?.start.toISO()).toBe(
      FIXED_NOW.startOf("week").plus({ days: 4, hours: 10 }).toISO(),
    );
  });

  it("updates this and future recurring events from a non-parent occurrence", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildRecurringEvent()],
      saveEvents,
    });

    const instanceBlock = document.querySelector(
      '[data-event-key="repeat-parent_2026-03-19"]',
    ) as HTMLElement;
    await user.dblClick(instanceBlock);
    expect(
      await screen.findByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();

    const titleInput = screen.getByDisplayValue("Daily standup");
    await user.clear(titleInput);
    await user.type(titleInput, "Team standup");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByText(/update recurring event/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /future events/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(2);

    const oldSeries = savedEvents.find((e) => e.id === "repeat-parent");
    const newSeries = savedEvents.find((e) => e.id !== "repeat-parent");

    // the old series is truncated to end right before the edited occurrence
    expect(oldSeries?.repeat?.until).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1 }).toMillis(),
    );

    // a new series starts at the edited occurrence with the new title
    expect(newSeries?.title).toBe("Team standup");
    expect(newSeries?._parent).toBeUndefined();
    expect(newSeries?.repeat).toEqual({ interval: 1, unit: "day" });
    expect(newSeries?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 8 }).toISO(),
    );
  });
});
