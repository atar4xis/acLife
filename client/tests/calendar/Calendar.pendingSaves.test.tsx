import { describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({
    user: { type: "online", id: "user-1" },
    masterKey: {} as CryptoKey,
    bucketKey: {} as CryptoKey,
    setUser: () => {},
    setMasterKey: () => {},
    setBucketKey: () => {},
    logout: () => {},
    checkLogin: async () => {},
  }),
}));

import {
  advanceSave,
  buildPlainEvent,
  buildSecondEvent,
  ctrlClickEvent,
  renderCalendar,
  setupCalendarTests,
} from "./helpers";
import {
  CalendarProvider,
  useCalendarActions,
} from "../../src/context/CalendarContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import type { EventChange } from "../../src/types/calendar/Event.ts";

setupCalendarTests();

type Save = [EventChange[], () => void];

const deleteSelected = () =>
  fireEvent.keyDown(document.body, { key: "Delete" });

const sentIds = (save: Save) => save[0].map((c) => c.event?.id ?? c.id);

describe("Calendar pending saves", () => {
  it("still saves a change made while an earlier save is waiting for its response", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    deleteSelected();
    await advanceSave();
    expect(saveEvents).toHaveBeenCalledTimes(1);

    await ctrlClickEvent("Retro");
    act(() => {
      deleteSelected();
      (saveEvents.mock.calls[0] as Save)[1]();
    });
    await advanceSave();

    expect(saveEvents).toHaveBeenCalledTimes(2);
    expect(sentIds(saveEvents.mock.calls[1] as Save)).toEqual(["second-event"]);
  });

  it("does not send an acknowledged change again", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    deleteSelected();
    await advanceSave();
    act(() => (saveEvents.mock.calls[0] as Save)[1]());

    await ctrlClickEvent("Retro");
    deleteSelected();
    await advanceSave();

    expect(sentIds(saveEvents.mock.calls[1] as Save)).toEqual(["second-event"]);
  });

  it("keeps resending an unacknowledged change with the next save", async () => {
    const saveEvents = vi.fn();
    renderCalendar({
      mode: "week",
      events: [buildPlainEvent(), buildSecondEvent()],
      saveEvents,
    });

    await ctrlClickEvent("Planning");
    deleteSelected();
    await advanceSave();

    await ctrlClickEvent("Retro");
    deleteSelected();
    await advanceSave();

    expect(sentIds(saveEvents.mock.calls[1] as Save).sort()).toEqual([
      "plain-event",
      "second-event",
    ]);
  });

  it("keeps an event's newer change when only its earlier change was acknowledged", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [buildPlainEvent()], saveEvents });

    await ctrlClickEvent("Planning");
    deleteSelected();
    await advanceSave();

    act(() => {
      fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
      (saveEvents.mock.calls[0] as Save)[1]();
    });
    await advanceSave();

    expect(saveEvents).toHaveBeenCalledTimes(2);
    const types = (saveEvents.mock.calls[1] as Save)[0].map((c) => c.type);
    expect(types[types.length - 1]).toBe("added");
  });

  it("drops unsent changes when the calendar unmounts", async () => {
    let pendingChanges!: Map<string, EventChange[]>;
    const Probe = () => {
      pendingChanges = useCalendarActions().pendingChanges;
      return null;
    };
    const { rerender } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
    });

    await ctrlClickEvent("Planning");
    deleteSelected();
    await advanceSave();
    rerender(
      <SettingsStoreProvider>
        {null}
        <CalendarProvider>
          <Probe />
        </CalendarProvider>
      </SettingsStoreProvider>,
    );

    expect(pendingChanges.size).toBe(0);
  });
});
