import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { focusGrid } from "./gridKeyboardHelpers";
import {
  advanceSave,
  buildEvent,
  buildRecurringEvent,
  ctrlClick,
  dispatchWindowPointer,
  FIXED_NOW,
  getEventBlock,
  getLastSavedEvents,
  renderCalendar,
  setupCalendarTests,
} from "./helpers";
import { seedSettings } from "../settingsStorage.ts";

setupCalendarTests();

const wait = (ms: number) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));

const pointer = { button: 0, pointerId: 1, pointerType: "mouse" };

const clickBlock = (block: Element, x = 0, y = 0) => {
  fireEvent.pointerDown(block, { ...pointer, clientX: x, clientY: y });
  dispatchWindowPointer("pointerup", { ...pointer, clientX: x, clientY: y });
  fireEvent.click(block, { clientX: x, clientY: y });
};

const detailsDialog = () =>
  screen.queryByRole("dialog", { name: /(event|task) details/i });

const openDetails = async (title: string) => {
  clickBlock(await getEventBlock(title));
  await wait(300);
  expect(detailsDialog()).toBeInTheDocument();
};

describe("event details", () => {
  it("shows the event after a single click", async () => {
    renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");

    const dialog = detailsDialog()!;
    expect(dialog).toHaveTextContent("Planning");
    expect(dialog).toHaveTextContent(FIXED_NOW.toFormat("EEE, MMM d"));
    expect(dialog).toHaveTextContent(/9 - 10 AM/);
    expect(screen.queryByRole("heading", { name: /edit event/i })).toBeNull();
  });

  it("lists the notifications in plain text without the method", async () => {
    renderCalendar({
      events: [
        buildEvent({
          notifications: [
            { when: "start", amount: 10, method: "sound" },
            { when: "minutes", amount: 5, method: "device" },
            { when: "hours", amount: 1, method: "all" },
            { when: "days", amount: 2, method: "sound" },
          ],
        }),
      ],
    });

    await openDetails("Planning");

    const dialog = detailsDialog()!;
    expect(dialog).toHaveTextContent("When the event starts");
    expect(dialog).toHaveTextContent("5 minutes before the event");
    expect(dialog).toHaveTextContent("1 hour before the event");
    expect(dialog).toHaveTextContent("2 days before the event");
    expect(dialog).not.toHaveTextContent(/sound|push/i);
    expect(dialog.querySelectorAll("svg.lucide-bell")).toHaveLength(1);
  });

  it("shows no notification rows for an event without any", async () => {
    renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");

    expect(detailsDialog()).not.toHaveTextContent("before the event");
    expect(detailsDialog()).not.toHaveTextContent("When the event starts");
  });

  it("shows after a touch tap", async () => {
    renderCalendar({ events: [buildEvent()] });

    const block = await getEventBlock("Planning");
    const touch = { ...pointer, pointerType: "touch" };
    fireEvent.pointerDown(block, { ...touch, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(block, { ...touch, clientX: 5, clientY: 5 });
    await wait(100);

    expect(detailsDialog()).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /edit event/i })).toBeNull();
  });

  it("waits for a possible double click before showing", async () => {
    renderCalendar({ events: [buildEvent()] });

    clickBlock(await getEventBlock("Planning"));
    await wait(100);
    expect(detailsDialog()).toBeNull();

    await wait(250);
    expect(detailsDialog()).toBeInTheDocument();
  });

  it("opens only the editor on a double click", async () => {
    renderCalendar({ events: [buildEvent()] });

    const block = await getEventBlock("Planning");
    clickBlock(block);
    clickBlock(block);
    fireEvent.doubleClick(block);
    await wait(400);

    expect(
      await screen.findByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();
    expect(detailsDialog()).toBeNull();
  });

  it("opens the editor on a click when set to edit", async () => {
    seedSettings({ eventClickAction: "edit" });
    renderCalendar({ events: [buildEvent()] });

    clickBlock(await getEventBlock("Planning"));
    await wait(300);

    expect(
      await screen.findByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();
    expect(detailsDialog()).toBeNull();
  });

  it("does nothing on a click when set to do nothing", async () => {
    seedSettings({ eventClickAction: "none" });
    renderCalendar({ events: [buildEvent()] });

    clickBlock(await getEventBlock("Planning"));
    await wait(300);

    expect(detailsDialog()).toBeNull();
    expect(screen.queryByRole("heading", { name: /edit event/i })).toBeNull();
  });

  it("shows details on a double click when set to details", async () => {
    seedSettings({ eventDoubleClickAction: "details" });
    renderCalendar({ events: [buildEvent()] });

    const block = await getEventBlock("Planning");
    clickBlock(block);
    clickBlock(block);
    fireEvent.doubleClick(block);

    expect(detailsDialog()).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /edit event/i })).toBeNull();
  });

  it("does nothing on a double click when set to do nothing", async () => {
    seedSettings({ eventDoubleClickAction: "none" });
    renderCalendar({ events: [buildEvent()] });

    const block = await getEventBlock("Planning");
    fireEvent.doubleClick(block);
    await wait(300);

    expect(detailsDialog()).toBeNull();
    expect(screen.queryByRole("heading", { name: /edit event/i })).toBeNull();
  });

  it("shows details at once when a double click does nothing", async () => {
    seedSettings({ eventDoubleClickAction: "none" });
    renderCalendar({ events: [buildEvent()] });

    clickBlock(await getEventBlock("Planning"));
    await wait(50);

    expect(detailsDialog()).toBeInTheDocument();
  });

  it("opens the editor on a tap when the click is set to edit", async () => {
    seedSettings({ eventClickAction: "edit" });
    renderCalendar({ events: [buildEvent()] });

    const block = await getEventBlock("Planning");
    const touch = { ...pointer, pointerType: "touch" };
    fireEvent.pointerDown(block, { ...touch, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(block, { ...touch, clientX: 5, clientY: 5 });
    await wait(100);

    expect(
      await screen.findByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();
  });

  it("does not come back after the editor opened by double click closes", async () => {
    const { user } = renderCalendar({ events: [buildEvent()] });

    const block = await getEventBlock("Planning");
    clickBlock(block);
    clickBlock(block);
    fireEvent.doubleClick(block);
    await screen.findByRole("heading", { name: /edit event/i });
    await wait(400);
    await user.click(screen.getByRole("button", { name: /close/i }));
    await wait(400);

    expect(detailsDialog()).toBeNull();
  });

  it("gives way to the editor opened from the keyboard", async () => {
    const { user } = renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");
    focusGrid();
    await user.keyboard("{Control>}{ArrowUp}{/Control}{Enter}");

    expect(
      await screen.findByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();
    expect(detailsDialog()).toBeNull();
  });

  it("opens on Enter for a focused event and the editor on a second Enter", async () => {
    const { user } = renderCalendar({ events: [buildEvent()] });
    await getEventBlock("Planning");
    focusGrid();

    await user.keyboard("{Control>}{ArrowUp}{/Control}{Enter}");
    expect(detailsDialog()).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /edit event/i })).toBeNull();

    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();
    expect(detailsDialog()).toBeNull();
  });

  it("closes keyboard-opened details with escape and opens them again on Enter", async () => {
    const { user } = renderCalendar({ events: [buildEvent()] });
    await getEventBlock("Planning");
    focusGrid();

    await user.keyboard("{Control>}{ArrowUp}{/Control}{Enter}{Escape}");
    expect(detailsDialog()).toBeNull();

    await user.keyboard("{Enter}");
    expect(detailsDialog()).toBeInTheDocument();
  });

  it("announces the whole event in a live region without taking focus", async () => {
    renderCalendar({
      events: [buildRecurringEvent({ description: "Bring notes" })],
    });

    await openDetails("Daily standup");

    const status = within(detailsDialog()!).getByRole("status");
    expect(status).toHaveTextContent(/Event details\. Daily standup, .*Bring notes/);
    expect(status).toHaveTextContent("Repeat daily");
    expect(detailsDialog()).not.toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it("closes when the block starts being dragged", async () => {
    renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");
    const block = await getEventBlock("Planning");
    fireEvent.pointerDown(block, { ...pointer, clientX: 10, clientY: 10 });
    expect(detailsDialog()).toBeInTheDocument();
    dispatchWindowPointer("pointermove", {
      ...pointer,
      clientX: 10,
      clientY: 60,
    });

    expect(detailsDialog()).toBeNull();
  });

  it("closes when a resize handle is pressed", async () => {
    renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");
    const block = await getEventBlock("Planning");
    fireEvent.pointerDown(block.querySelector(".resize-handle")!, pointer);

    expect(detailsDialog()).toBeNull();
  });

  it("does not show after a drag that ends where it started", async () => {
    renderCalendar({ events: [buildEvent()] });

    const block = await getEventBlock("Planning");
    fireEvent.pointerDown(block, { ...pointer, clientX: 10, clientY: 10 });
    dispatchWindowPointer("pointermove", {
      ...pointer,
      clientX: 10,
      clientY: 60,
    });
    dispatchWindowPointer("pointermove", {
      ...pointer,
      clientX: 10,
      clientY: 10,
    });
    dispatchWindowPointer("pointerup", { ...pointer, clientX: 10, clientY: 10 });
    fireEvent.click(block, { clientX: 10, clientY: 10 });
    await wait(300);

    expect(detailsDialog()).toBeNull();
  });

  it("does not show on a ctrl click", async () => {
    renderCalendar({ events: [buildEvent()] });

    const block = await getEventBlock("Planning");
    ctrlClick(block);
    fireEvent.click(block, { ctrlKey: true });
    await wait(300);

    expect(detailsDialog()).toBeNull();
  });

  it("does not show on a click without a mouse press on the block", async () => {
    renderCalendar({ events: [buildEvent()] });

    fireEvent.click(await getEventBlock("Planning"));
    await wait(300);

    expect(detailsDialog()).toBeNull();
  });

  it("opens the editor from the pencil and closes itself", async () => {
    const { user } = renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");
    await user.click(screen.getByRole("button", { name: /edit event/i }));

    expect(
      await screen.findByRole("heading", { name: /edit event/i }),
    ).toBeInTheDocument();
    expect(detailsDialog()).toBeNull();
  });

  it("closes with the close button", async () => {
    const { user } = renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");
    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(detailsDialog()).toBeNull();
    expect(screen.queryByRole("heading", { name: /edit event/i })).toBeNull();
  });

  it("does not come back after the pencil's editor closes", async () => {
    const { user } = renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");
    await user.click(screen.getByRole("button", { name: /edit event/i }));
    await user.click(screen.getByRole("button", { name: /close/i }));
    await wait(400);

    expect(detailsDialog()).toBeNull();
  });

  it("does not come back after a double click's editor closes while open", async () => {
    const { user } = renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");
    fireEvent.doubleClick(await getEventBlock("Planning"));
    await screen.findByRole("heading", { name: /edit event/i });
    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(detailsDialog()).toBeNull();
  });

  it("does not show for a bare click after an earlier press-and-click", async () => {
    renderCalendar({ events: [buildEvent()] });

    const block = await getEventBlock("Planning");
    clickBlock(block);
    await wait(300);
    fireEvent.pointerDown(document.body, pointer);
    expect(detailsDialog()).toBeNull();

    fireEvent.click(block);
    await wait(300);

    expect(detailsDialog()).toBeNull();
  });

  it("closes even when something stops the press from bubbling", async () => {
    renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");
    const stopper = document.body.appendChild(document.createElement("div"));
    stopper.addEventListener("pointerdown", (e) => e.stopPropagation());
    fireEvent.pointerDown(stopper, pointer);

    expect(detailsDialog()).toBeNull();
    stopper.remove();
  });

  it("moves with a drag on the header", async () => {
    renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");
    const header = screen.getByRole("heading", { name: /event details/i });
    expect(header.parentElement).toHaveClass("cursor-grab");

    const { left, top } = detailsDialog()!.style;
    fireEvent.pointerDown(header, { ...pointer, clientX: 10, clientY: 10 });
    dispatchWindowPointer("pointermove", { ...pointer, clientX: 60, clientY: 40 });
    dispatchWindowPointer("pointerup", pointer);

    expect(detailsDialog()).toHaveStyle({
      left: `${parseFloat(left) + 50}px`,
      top: `${parseFloat(top) + 30}px`,
    });
  });

  it("sits beside the block", async () => {
    const rects = new Map<string, DOMRect>();
    const box = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("event-block")) return box(500, 200, 100, 50);
        if (this.getAttribute("role") === "dialog") return box(0, 0, 200, 100);
        if (this.getAttribute("role") === "grid") return box(100, 0, 800, 600);
        return rects.get("none") ?? box(0, 0, 0, 0);
      },
    );
    renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");

    expect(detailsDialog()).toHaveStyle({ left: "300px", top: "200px" });
  });

  it("closes with escape", async () => {
    const { user } = renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");
    await user.keyboard("{Escape}");

    expect(detailsDialog()).toBeNull();
  });

  it("closes when pressing outside but not on its own block", async () => {
    renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");
    fireEvent.pointerDown(await getEventBlock("Planning"), pointer);
    expect(detailsDialog()).toBeInTheDocument();

    fireEvent.pointerDown(document.body, pointer);
    expect(detailsDialog()).toBeNull();
  });

  it("stays open when pressing inside the dialog", async () => {
    renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");
    fireEvent.pointerDown(detailsDialog()!, pointer);

    expect(detailsDialog()).toBeInTheDocument();
  });

  it("shows the event color", async () => {
    renderCalendar({ events: [buildEvent({ color: "#ff0000" })] });

    await openDetails("Planning");

    expect(detailsDialog()!.querySelector(".rounded-full")).toHaveStyle({
      backgroundColor: "#ff0000",
    });
  });

  it("shows a completed task as checked", async () => {
    renderCalendar({ events: [buildEvent({ isTask: true, completed: true })] });

    await openDetails("Planning");

    expect(
      within(detailsDialog()!).getByRole("checkbox", { name: /completed/i }),
    ).toBeChecked();
  });

  it("shows the description only when there is one", async () => {
    renderCalendar({
      events: [buildEvent(), buildEvent({ id: "b", title: "Retro", description: undefined })],
    });

    await openDetails("Planning");
    expect(detailsDialog()).toHaveTextContent("Sprint planning");
    fireEvent.pointerDown(document.body, pointer);

    await openDetails("Retro");
    expect(detailsDialog()).not.toHaveTextContent("Sprint planning");
    expect(detailsDialog()!.querySelector("p")).toBeNull();
  });

  it("describes the repeat of a repeating event", async () => {
    renderCalendar({
      events: [buildRecurringEvent()],
      mode: "week",
    });

    clickBlock((await screen.findAllByText("Daily standup"))[0].closest(".event-block")!);
    await wait(300);

    expect(detailsDialog()).toHaveTextContent("Repeat daily");
  });

  it("shows a custom repeat as a sentence", async () => {
    renderCalendar({
      events: [
        buildEvent({ repeat: { interval: 2, unit: "week", days: [1, 3] } }),
      ],
      mode: "week",
    });

    clickBlock((await screen.findAllByText("Planning"))[0].closest(".event-block")!);
    await wait(300);

    expect(detailsDialog()).toHaveTextContent(
      "Every 2 weeks on Monday and Wednesday",
    );
  });

  it("shows no repeat row for a one-off event", async () => {
    renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");

    expect(detailsDialog()).not.toHaveTextContent(/repeat|every/i);
  });

  it("says all day for an all-day event", async () => {
    renderCalendar({
      events: [
        buildEvent({
          allDay: true,
          start: FIXED_NOW.startOf("day"),
          end: FIXED_NOW.endOf("day"),
        }),
      ],
    });

    await openDetails("Planning");

    expect(detailsDialog()).toHaveTextContent("All day");
    expect(detailsDialog()).not.toHaveTextContent(/AM|PM/);
  });

  it("titles a task and toggles its completion", async () => {
    const { user, saveEvents } = renderCalendar({
      events: [buildEvent({ isTask: true, completed: false })],
    });

    await openDetails("Planning");
    expect(
      screen.getByRole("dialog", { name: /task details/i }),
    ).toBeInTheDocument();

    await user.click(
      within(detailsDialog()!).getByRole("checkbox", { name: /completed/i }),
    );
    await advanceSave();

    expect(getLastSavedEvents(saveEvents)[0].completed).toBe(true);
  });

  it("has no completion checkbox for a plain event", async () => {
    renderCalendar({ events: [buildEvent()] });

    await openDetails("Planning");

    expect(
      within(detailsDialog()!).queryByRole("checkbox", { name: /completed/i }),
    ).toBeNull();
  });
});
