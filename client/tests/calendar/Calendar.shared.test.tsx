import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { focusGrid } from "./gridKeyboardHelpers";
import {
  advanceSave,
  buildEvent,
  dayCenterX,
  dragEvent,
  getEventBlock,
  openEventMenu,
  renderCalendar,
  setupCalendarTests,
  timeToClientY,
} from "./helpers";
import type { CalendarEvent } from "../../src/types/calendar/Event";
import type { SharedInfo } from "../../src/types/Share";

setupCalendarTests();

const info = (extra: Partial<SharedInfo> = {}): SharedInfo => ({
  space: "s1",
  owner: "o1",
  scope: "collection",
  permission: "write",
  ...extra,
});

const shared = (extra: Partial<SharedInfo> = {}, rest: Partial<CalendarEvent> = {}) =>
  buildEvent({ title: "Shared planning", _shared: info(extra), ...rest });

const wait = (ms: number) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));

const detailsDialog = () =>
  screen.queryByRole("dialog", { name: /(event|task) details/i });

const clickBlock = (block: Element) => {
  const pointer = { button: 0, pointerId: 1, pointerType: "mouse" };
  fireEvent.pointerDown(block, pointer);
  fireEvent.pointerUp(block, pointer);
  fireEvent.click(block);
};

const dragDown = () =>
  dragEvent({
    title: "Shared planning",
    startX: dayCenterX(0),
    startY: timeToClientY(9),
    endX: dayCenterX(0),
    endY: timeToClientY(11),
  });

describe("the shared badge", () => {
  it("marks an event somebody shared with me", async () => {
    renderCalendar({ mode: "week", events: [shared()] });

    const block = await getEventBlock("Shared planning");
    expect(block.querySelector(".lucide-users")).not.toBeNull();
  });

  it("is not on my own events", async () => {
    renderCalendar({ mode: "week", events: [buildEvent({ title: "Mine" })] });

    const block = await getEventBlock("Mine");
    expect(block.querySelector(".lucide-users")).toBeNull();
  });
});

describe("a shared event I can only view", () => {
  const readOnly = () => shared({ permission: "read" });

  it("cannot be dragged", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [readOnly()], saveEvents });

    await dragDown();
    await advanceSave();

    expect(saveEvents).not.toHaveBeenCalled();
    const block = await getEventBlock("Shared planning");
    expect(block).toBeTruthy();
  });

  it("cannot be deleted with the keyboard", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({ events: [readOnly()], saveEvents });
    await screen.findByText("Shared planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Delete}");
    await advanceSave();

    expect(screen.getByText("Shared planning")).toBeInTheDocument();
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("shows details without a way to edit", async () => {
    renderCalendar({ events: [readOnly()] });
    clickBlock(await getEventBlock("Shared planning"));
    await wait(300);

    const dialog = detailsDialog()!;
    expect(dialog).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit event/i }),
    ).toBeNull();
  });

  it("has a menu without edit, move or delete", async () => {
    const { user } = renderCalendar({ events: [readOnly()] });
    await openEventMenu(user, "Shared planning");

    expect(await screen.findByText("Duplicate")).toBeInTheDocument();
    expect(screen.queryByText("Edit")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
    expect(screen.queryByText("Move")).toBeNull();
  });

  it("does not open the editor from the keyboard either", async () => {
    const { user } = renderCalendar({ events: [readOnly()] });
    await screen.findByText("Shared planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Enter}");
    await wait(300);
    expect(detailsDialog()).toBeInTheDocument();

    await user.keyboard("{Enter}");
    await wait(300);
    expect(screen.queryByRole("heading", { name: /edit event/i })).toBeNull();
  });

  it("opens the details instead of the editor on double click", async () => {
    const { user } = renderCalendar({ events: [readOnly()] });
    await user.dblClick(await getEventBlock("Shared planning"));
    await wait(300);

    expect(screen.queryByRole("heading", { name: /edit event/i })).toBeNull();
  });

  it("can be duplicated into my own calendar", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({ events: [readOnly()], saveEvents });
    await openEventMenu(user, "Shared planning");
    await user.click(await screen.findByText("Duplicate"));
    await advanceSave();

    const saved = saveEvents.mock.lastCall![0] as CalendarEvent[];
    expect(saved).toHaveLength(2);
    expect(saved.find((e) => e.id !== "plain-event")?._shared).toBeUndefined();
    expect(saved.find((e) => e.id === "plain-event")?._shared).toBeDefined();
  });
});

describe("a shared event I can write", () => {
  it("is dragged and keeps its space", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [shared()], saveEvents });

    await dragDown();
    await advanceSave();

    const [saved] = saveEvents.mock.lastCall![0] as CalendarEvent[];
    expect(saved.start.hour).toBe(11);
    expect(saved._shared?.space).toBe("s1");
  });

  it("is deleted", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({ events: [shared()], saveEvents });
    await screen.findByText("Shared planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Delete}");
    await advanceSave();

    expect(screen.queryByText("Shared planning")).toBeNull();
    expect(saveEvents.mock.lastCall![0]).toEqual([]);
  });

  it("opens the editor on double click", async () => {
    const { user } = renderCalendar({ events: [shared()] });
    await user.dblClick(await getEventBlock("Shared planning"));
    expect(
      await screen.findByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();
  });
});

describe("a single shared event I can write", () => {
  const single = () => shared({ scope: "item" });

  it("can be moved", async () => {
    const saveEvents = vi.fn();
    renderCalendar({ mode: "week", events: [single()], saveEvents });

    await dragDown();
    await advanceSave();
    expect(saveEvents).toHaveBeenCalled();
  });

  it("cannot be deleted", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({ events: [single()], saveEvents });
    await screen.findByText("Shared planning");
    focusGrid();
    await user.keyboard("{PageUp}{Enter}{Delete}");
    await advanceSave();

    expect(screen.getByText("Shared planning")).toBeInTheDocument();
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("has no delete in its menu", async () => {
    const { user } = renderCalendar({ events: [single()] });
    await openEventMenu(user, "Shared planning");

    expect(await screen.findByText("Edit")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).toBeNull();
  });
});

