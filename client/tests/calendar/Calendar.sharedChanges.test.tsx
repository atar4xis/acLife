import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { focusGrid } from "./gridKeyboardHelpers";
import {
  advanceSave,
  buildEvent,
  buildRecurringEvent,
  dayCenterX,
  dragEvent,
  FIXED_NOW,
  getEventBlock,
  openEventMenu,
  renderCalendar,
  setupCalendarTests,
  timeToClientY,
} from "./helpers";
import { toast } from "sonner";
import type { EventChange } from "../../src/types/calendar/Event";
import type { SharedInfo } from "../../src/types/Share";

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({
    user: { type: "online", uuid: "me", subscription_status: "active" },
    masterKey: {},
    bucketKey: {},
  }),
}));

const openShare = vi.hoisted(() => vi.fn());
const nicknames = vi.hoisted(() => ({ value: {} as Record<string, string> }));

vi.mock("../../src/context/ShareContext.tsx", () => ({
  useShares: () => ({
    nameOf: (uuid: string, email: string) => nicknames.value[uuid] ?? email,
    enabled: true,
    joined: [
      {
        id: "s1",
        owner: "o1",
        ownerEmail: "owner@example.com",
        kind: "calendar",
        scope: "collection",
        permission: "write",
      },
      {
        id: "s2",
        owner: "o2",
        ownerEmail: "viewer@example.com",
        kind: "calendar",
        scope: "collection",
        permission: "read",
      },
      {
        id: "s3",
        owner: "o3",
        ownerEmail: "single@example.com",
        kind: "calendar",
        scope: "item",
        permission: "write",
      },
    ],
    openShare,
  }),
}));

setupCalendarTests();

const info = (extra: Partial<SharedInfo> = {}): SharedInfo => ({
  space: "s1",
  owner: "o1",
  scope: "collection",
  permission: "write",
  ...extra,
});

const shared = (extra: Partial<SharedInfo> = {}) =>
  buildEvent({ title: "Shared planning", _shared: info(extra) });

const changesOf = (saveEvents: ReturnType<typeof vi.fn>) =>
  saveEvents.mock.lastCall![0] as EventChange[];

describe("changes to shared events", () => {
  it("carry the event with its space when it moves", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [shared()], saveEvents });

    await dragEvent({
      title: "Shared planning",
      startX: dayCenterX(0),
      startY: timeToClientY(9),
      endX: dayCenterX(0),
      endY: timeToClientY(11),
    });
    await advanceSave();

    const [change] = changesOf(saveEvents);
    expect(change.type).toBe("updated");
    expect(change.event?._shared?.space).toBe("s1");
  });

  it("say which space a deleted event was in", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({ events: [shared()], saveEvents });
    await screen.findByText("Shared planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Delete}");
    await advanceSave();

    expect(changesOf(saveEvents)).toEqual([
      { type: "deleted", id: "plain-event", space: "s1" },
    ]);
  });

  it("are not recorded at all for a read-only event", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      mode: "week",
      events: [shared({ permission: "read" })],
      saveEvents,
    });
    await dragEvent({
      title: "Shared planning",
      startX: dayCenterX(0),
      startY: timeToClientY(9),
      endX: dayCenterX(0),
      endY: timeToClientY(11),
    });
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Delete}");
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("send no delete for an event that is shared as a single item", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [shared({ scope: "item" })],
      saveEvents,
    });
    await screen.findByText("Shared planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Delete}");
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
  });


  it("lists a shared calendar by the nickname of its owner", async () => {
    nicknames.value = { o1: "Boss" };
    const { user } = renderCalendar({ events: [buildEvent({ title: "Mine" })] });

    await user.dblClick(await getEventBlock("Mine"));
    await screen.findByRole("heading", { name: /edit event/i });
    await user.click(screen.getByRole("combobox", { name: "Calendar" }));

    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "My calendar",
      "Boss",
    ]);
    nicknames.value = {};
  });

  it("move an event to a shared calendar as a delete and an add", async () => {
    const saveEvents = vi.fn();
    const mine = buildEvent({ title: "Mine" });
    const { user } = renderCalendar({ events: [mine], saveEvents });

    await user.dblClick(await getEventBlock("Mine"));
    await screen.findByRole("heading", { name: /edit event/i });

    await user.click(screen.getByRole("combobox", { name: "Calendar" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "My calendar",
      "owner@example.com",
    ]);
    await user.click(screen.getByRole("option", { name: "owner@example.com" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await advanceSave();

    const changes = changesOf(saveEvents);
    expect(changes.map((c) => c.type)).toEqual(["deleted", "added"]);
    expect(changes[0].space).toBeUndefined();
    expect(changes[1].event?._shared?.space).toBe("s1");
    expect(changes[1].event?.id).toBe("plain-event");
  });

  it("move an event back from a shared calendar to my own", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({ events: [shared()], saveEvents });

    await user.dblClick(await getEventBlock("Shared planning"));
    await screen.findByRole("heading", { name: /edit event/i });
    await user.click(screen.getByRole("combobox", { name: "Calendar" }));
    await user.click(await screen.findByRole("option", { name: "My calendar" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await advanceSave();

    const changes = changesOf(saveEvents);
    expect(changes.map((c) => c.type)).toEqual(["deleted", "added"]);
    expect(changes[0].space).toBe("s1");
    expect(changes[1].event?._shared).toBeUndefined();
  });

  it("do not offer a calendar choice for an event that cannot leave its space", async () => {
    const { user } = renderCalendar({
      events: [shared({ scope: "item" })],
    });

    await user.dblClick(await getEventBlock("Shared planning"));
    await screen.findByRole("heading", { name: /edit event/i });
    expect(screen.queryByRole("combobox", { name: "Calendar" })).toBeNull();
  });

  it("keep the space of an event shared as a single item when it is edited", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [shared({ space: "s3", scope: "item" })],
      saveEvents,
    });

    await user.dblClick(await getEventBlock("Shared planning"));
    await screen.findByRole("heading", { name: /edit event/i });
    const title = screen.getByDisplayValue("Shared planning");
    await user.clear(title);
    await user.type(title, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await advanceSave();

    const [change] = changesOf(saveEvents);
    expect(change.type).toBe("updated");
    expect(change.event?.title).toBe("Renamed");
    expect(change.event?._shared?.space).toBe("s3");
  });

  it("offer to share an event of mine", async () => {
    const { user } = renderCalendar({ events: [buildEvent({ title: "Mine" })] });
    await openEventMenu(user, "Mine");
    await user.click(await screen.findByText("Share..."));

    expect(openShare).toHaveBeenCalledWith({
      kind: "calendar",
      scope: "item",
      target: "plain-event",
      label: "Mine",
    });
  });

  describe("a recurring event of mine", () => {
    it("offers to share one occurrence or the whole series, not a plain share", async () => {
      const { user } = renderCalendar({ events: [buildRecurringEvent()] });
      await openEventMenu(user, "Daily standup");

      await screen.findByText("Share only this event...");
      expect(screen.getByText("Share the whole series...")).toBeTruthy();
      expect(screen.queryByText("Share...")).toBeNull();
    });

    it("shares the series through the parent event", async () => {
      openShare.mockClear();
      const { user } = renderCalendar({ events: [buildRecurringEvent()] });
      await openEventMenu(user, "Daily standup");
      await user.click(await screen.findByText("Share the whole series..."));

      expect(openShare).toHaveBeenCalledWith({
        kind: "calendar",
        scope: "item",
        target: "repeat-parent",
        label: "Daily standup",
      });
    });

    it("shares the series of a later occurrence through the parent, not the occurrence", async () => {
      openShare.mockClear();
      const started = FIXED_NOW.startOf("day").minus({ days: 3 });
      const { user } = renderCalendar({
        events: [
          buildRecurringEvent({
            start: started.plus({ hours: 8 }),
            end: started.plus({ hours: 9 }),
          }),
        ],
      });
      await openEventMenu(user, "Daily standup");
      await user.click(await screen.findByText("Share the whole series..."));

      expect(openShare.mock.lastCall![0].target).toBe("repeat-parent");
    });

    it("shares an occurrence as its own event and leaves the rest of the series out", async () => {
      openShare.mockClear();
      const saveEvents = vi.fn();
      const { user } = renderCalendar({
        events: [buildRecurringEvent()],
        saveEvents,
      });
      await openEventMenu(user, "Daily standup");
      await user.click(await screen.findByText("Share only this event..."));
      await advanceSave();

      const [{ target: prepare, scope, label }] = openShare.mock.lastCall!;
      expect(scope).toBe("item");
      expect(label).toBe("Daily standup");
      expect(saveEvents).not.toHaveBeenCalled();

      const target = (prepare as () => string)();
      await advanceSave();
      expect(target).not.toBe("repeat-parent");

      const changes = changesOf(saveEvents);
      const added = changes.find((c) => c.type === "added");
      expect(added?.event?.id).toBe(target);
      expect(added?.event?.repeat).toBeUndefined();
      expect(changes.some((c) => c.event?.id === "repeat-parent")).toBe(true);
      expect(toast.info).toHaveBeenCalledWith(
        "This event is now separate from the series. The rest of the series stays private.",
      );
    });
  });

  it("do not offer to share an event somebody shared with me", async () => {
    const { user } = renderCalendar({ events: [shared()] });
    await openEventMenu(user, "Shared planning");

    await screen.findByText("Duplicate");
    expect(screen.queryByText("Share...")).toBeNull();
  });
});
