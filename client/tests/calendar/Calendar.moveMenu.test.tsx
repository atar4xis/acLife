import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import {
  FIXED_NOW,
  buildPlainEvent,
  buildSecondEvent,
  buildRecurringEvent,
  renderCalendar,
  advanceSave,
  getLastSavedEvents,
  ctrlClickEvent,
  openEventMenu,
  setupCalendarTests,
} from "./helpers";

setupCalendarTests();

const openMoveSubmenu = async (
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) => {
  await openEventMenu(user, title);
  fireEvent.click(await screen.findByRole("menuitem", { name: /move\.\.\./i }));
};

describe("Calendar move menu", () => {
  it("moves an event forward by a fixed number of minutes", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openMoveSubmenu(user, "Planning");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /forward\.\.\./i }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "30 minutes" }));

    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 9, minutes: 30 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 10, minutes: 30 }).toISO(),
    );
  });

  it("moves an event backward by a fixed number of hours", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openMoveSubmenu(user, "Planning");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /backward\.\.\./i }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "2 hours" }));

    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 7 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 8 }).toISO(),
    );
  });

  it("moves an event to the next occurrence of a unit", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openMoveSubmenu(user, "Planning");
    fireEvent.click(await screen.findByRole("menuitem", { name: /^next\.\.\.$/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Day" }));

    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 9 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 10 }).toISO(),
    );
  });

  it("moves an event to the previous occurrence of a unit", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });

    await openMoveSubmenu(user, "Planning");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /^previous\.\.\.$/i }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Week" }));

    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents[0].start.toISO()).toBe(
      FIXED_NOW.startOf("day").minus({ weeks: 1 }).plus({ hours: 9 }).toISO(),
    );
    expect(savedEvents[0].end.toISO()).toBe(
      FIXED_NOW.startOf("day").minus({ weeks: 1 }).plus({ hours: 10 }).toISO(),
    );
  });

  it("moves an event to the next free slot", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await openMoveSubmenu(user, "Planning");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /next free slot/i }),
    );

    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");

    expect(planning?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 10 }).toISO(),
    );
    expect(planning?.end.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 11 }).toISO(),
    );
  });

  it("moves a single recurring event via the menu without prompting, detaching only that occurrence", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildRecurringEvent()],
      saveEvents,
    });

    await openMoveSubmenu(user, "Daily standup");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /forward\.\.\./i }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "1 hour" }));

    await advanceSave();

    expect(
      screen.queryByText(/update recurring event/i),
    ).not.toBeInTheDocument();

    const savedEvents = getLastSavedEvents(saveEvents);
    expect(savedEvents).toHaveLength(2);

    const parent = savedEvents.find((e) => e.id === "repeat-parent");
    const detached = savedEvents.find((e) => e.id !== "repeat-parent");

    // the parent hops to its next occurrence (tomorrow), unaffected by the move
    expect(parent?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ days: 1, hours: 8 }).toISO(),
    );
    // only today's detached occurrence is actually moved
    expect(detached?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 9 }).toISO(),
    );
    expect(detached?.repeat).toBeUndefined();
  });

  it("moves every selected event by the same offset from the move menu", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    await ctrlClickEvent("Retro");

    await openMoveSubmenu(user, "Planning");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /forward\.\.\./i }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "1 hour" }));

    await advanceSave();

    const savedEvents = getLastSavedEvents(saveEvents);
    const planning = savedEvents.find((e) => e.id === "plain-event");
    const retro = savedEvents.find((e) => e.id === "second-event");

    expect(planning?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 10 }).toISO(),
    );
    expect(retro?.start.toISO()).toBe(
      FIXED_NOW.startOf("day").plus({ hours: 14 }).toISO(),
    );
  });
});
