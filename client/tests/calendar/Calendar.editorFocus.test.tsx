import { describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AgendaList from "../../src/components/calendar/AgendaList.tsx";
import AppCalendar from "../../src/components/calendar/Calendar.tsx";
import { CalendarProvider } from "../../src/context/CalendarContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import { SidebarProvider } from "../../src/components/ui/sidebar.tsx";
import {
  FIXED_NOW,
  advanceSave,
  buildEvent,
  buildPlainEvent,
  buildRecurringEvent,
  getEventBlock,
  getLastSavedEvents,
  openEventEditor,
  openEventMenu,
  renderCalendar,
  setupCalendarTests,
} from "./helpers";
import { slotDomId } from "../../src/lib/calendar/gridFocus.ts";
import { focusGrid, grid, spoken } from "./gridKeyboardHelpers";
import { expectNoViolations } from "../a11y/axe.ts";

setupCalendarTests();

const today = FIXED_NOW.startOf("day");
const editor = () => screen.getByRole("dialog", { name: "Edit event" });

// Planning is 9:00-10:00, so one hour up from the start slot lands on it
const openFromKeyboard = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByText("Planning");
  focusGrid();
  await user.keyboard("{PageUp}{Enter}{Enter}{Enter}");
  await screen.findByRole("dialog", { name: "Edit event" });
};

const expectBackOnEvent = async (block?: HTMLElement) => {
  await waitFor(() => expect(grid()).toHaveFocus());
  expect(grid()).toHaveAttribute("data-keyboard-mode");
  if (block) expect(grid()).toHaveAttribute("aria-activedescendant", block.id);
};

describe("Event editor dialog", () => {
  it("is a labelled modal dialog", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openEventEditor(user, "Planning");

    const dialog = editor();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Edit event");
    expect(dialog.querySelector("h3")).toHaveAttribute(
      "id",
      dialog.getAttribute("aria-labelledby"),
    );
  });

  it("keeps its class list and inline placement unchanged", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openEventEditor(user, "Planning");

    expect(editor().className).toContain("event-editor fixed z-20");
    expect(editor().style.top).not.toBe("");
    expect(editor().style.left).not.toBe("");
  });

  it("has no axe violations as a dialog, region rule included", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openEventEditor(user, "Planning");

    await expectNoViolations(document.body);
  });

  it("still saves with Ctrl+S", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await openFromKeyboard(user);
    await user.keyboard("{Control>}s{/Control}");
    await advanceSave();

    expect(saveEvents).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Event editor focus: opened from the keyboard", () => {
  it("moves focus to the title field", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);

    expect(screen.getByDisplayValue("Planning")).toHaveFocus();
    expect(editor()).toContainElement(document.activeElement as HTMLElement);
  });

  it("returns focus to the event in keyboard mode on Escape", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    await user.keyboard("{Escape}");

    await expectBackOnEvent(await getEventBlock("Planning"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves the slot with the arrow keys afterwards, not the date", async () => {
    const { user } = renderCalendar({
      mode: "week",
      events: [buildPlainEvent()],
    });
    await openFromKeyboard(user);
    await user.keyboard("{Escape}");
    await expectBackOnEvent();
    await user.keyboard("{ArrowDown}");

    expect(spoken()).toContain("9:35 AM");
    await user.keyboard("{ArrowRight}");
    expect(spoken()).toContain("Thursday 19 March");
    expect(screen.getByText("Wed 18")).toBeInTheDocument();
    expect(screen.queryByText("Wed 25")).toBeNull();
  });

  it("shows the outline again after closing", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    await user.keyboard("{Escape}");
    await expectBackOnEvent();

    const block = await getEventBlock("Planning");
    expect(block.className).toContain(
      "group-data-[keyboard-mode]/grid:outline-2",
    );
  });

  it("returns focus after saving with the Save button, even when clicked", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents,
    });
    await openFromKeyboard(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await expectBackOnEvent(await getEventBlock("Planning"));
  });

  it("returns focus after saving with Ctrl+S", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    await user.keyboard("{Control>}s{/Control}");

    await expectBackOnEvent();
  });

  it("returns focus after Cancel and Close", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await expectBackOnEvent();

    act(() => grid().blur());
    await user.keyboard("{Enter}");
    focusGrid();
    await user.keyboard("{Enter}{Enter}");
    await screen.findByRole("dialog", { name: "Edit event" });
    await user.click(screen.getByRole("button", { name: "Close" }));
    await expectBackOnEvent();
  });

  it("returns focus to the slot after deleting the event", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    await user.click(screen.getByRole("button", { name: "Delete event" }));

    await expectBackOnEvent();
    await waitFor(() =>
      expect(grid()).toHaveAttribute(
        "aria-activedescendant",
        expect.stringMatching(/^calendar-slot-/),
      ),
    );
    expect(document.querySelector('[id^="calendar-slot-"]')).not.toBeNull();
    expect(screen.queryByText("Planning")).toBeNull();
  });

  it("returns focus after duplicating", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    await user.click(screen.getByRole("button", { name: "Duplicate event" }));

    await expectBackOnEvent();
  });

  it("does not take focus back after a click elsewhere closed it", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    await user.click(screen.getByTestId("next-btn"));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("next-btn")).toHaveFocus();
    expect(grid()).not.toHaveAttribute("data-keyboard-mode");
  });

  it("opens from a context menu item activated with the keyboard", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openEventMenu(user, "Planning");
    await screen.findByRole("menuitem", { name: /edit/i });
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    await screen.findByRole("dialog", { name: "Edit event" });
    await waitFor(() =>
      expect(screen.getByDisplayValue("Planning")).toHaveFocus(),
    );
    await user.keyboard("{Escape}");
    await expectBackOnEvent();
  });

  it("returns focus to the agenda button that opened it", async () => {
    const user = userEvent.setup();
    render(
      <SettingsStoreProvider>
        <CalendarProvider>
          <SidebarProvider>
            <AgendaList />
          </SidebarProvider>
          <AppCalendar
            events={[
              buildEvent({
                id: "later",
                title: "Retro",
                start: today.plus({ hours: 13 }),
                end: today.plus({ hours: 14 }),
              }),
            ]}
            mode="day"
            setMode={vi.fn()}
            saveEvents={vi.fn()}
            syncEvents={vi.fn()}
            syncBuckets={vi.fn()}
            saveDebounceMs={0}
          />
        </CalendarProvider>
      </SettingsStoreProvider>,
    );
    const agendaButton = (await screen.findAllByText("Retro"))
      .map((node) => node.closest("button"))
      .find((button) => button !== null)!;
    act(() => agendaButton.focus());
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Edit event" });
    expect(screen.getByDisplayValue("Retro")).toHaveFocus();
    await user.keyboard("{Escape}");

    await waitFor(() => expect(agendaButton).toHaveFocus());
  });

  it("falls back to the event's slot when the agenda button is gone", async () => {
    const user = userEvent.setup();
    render(
      <SettingsStoreProvider>
        <CalendarProvider>
          <SidebarProvider>
            <AgendaList />
          </SidebarProvider>
          <AppCalendar
            events={[
              buildEvent({
                id: "later",
                title: "Retro",
                start: today.plus({ hours: 13 }),
                end: today.plus({ hours: 14 }),
              }),
            ]}
            mode="day"
            setMode={vi.fn()}
            saveEvents={vi.fn()}
            syncEvents={vi.fn()}
            syncBuckets={vi.fn()}
            saveDebounceMs={0}
          />
        </CalendarProvider>
      </SettingsStoreProvider>,
    );
    const agendaButton = (await screen.findAllByText("Retro"))
      .map((node) => node.closest("button"))
      .find((button) => button !== null)!;
    act(() => agendaButton.focus());
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Edit event" });
    await user.click(screen.getByRole("button", { name: "Delete event" }));

    await waitFor(() => expect(grid()).toHaveFocus());
    expect(grid()).toHaveAttribute("aria-activedescendant", slotDomId(0, 780));
    expect(document.getElementById(slotDomId(0, 780))!.style.top).toBe("780px");
  });
});

describe("Event editor focus: opened with a pointer", () => {
  it("does not move focus when opened by double click", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openEventEditor(user, "Planning");

    expect(editor().contains(document.activeElement)).toBe(false);
  });

  it("does not move focus when closed", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openEventEditor(user, "Planning");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(grid()).not.toHaveFocus();
    expect(grid()).not.toHaveAttribute("data-keyboard-mode");
  });

  it("does not move focus when closed with Escape from the title field", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openEventEditor(user, "Planning");
    await user.click(screen.getByDisplayValue("Planning"));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(grid()).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it("does not move focus when opened from the context menu with the mouse", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openEventMenu(user, "Planning");
    await user.click(await screen.findByRole("menuitem", { name: /edit/i }));

    await screen.findByRole("dialog", { name: "Edit event" });
    expect(editor().contains(document.activeElement)).toBe(false);
  });
});

describe("Event editor focus trap", () => {
  const tabbables = () =>
    Array.from(
      editor().querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );

  it("wraps Tab from the last control to the first", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    const items = tabbables();
    act(() => items[items.length - 1].focus());
    await user.keyboard("{Tab}");

    expect(items[0]).toHaveFocus();
  });

  it("wraps Shift+Tab from the first control to the last", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    const items = tabbables();
    act(() => items[0].focus());
    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(items[items.length - 1]).toHaveFocus();
  });

  it("moves through controls in order in the middle", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    const items = tabbables();
    act(() => items[1].focus());
    await user.keyboard("{Tab}");
    expect(items[2]).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(items[1]).toHaveFocus();
  });

  it("pulls Tab into the dialog when focus is on the page background", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openEventEditor(user, "Planning");
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Tab}");
    expect(tabbables()[0]).toHaveFocus();

    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    const items = tabbables();
    expect(items[items.length - 1]).toHaveFocus();
  });

  it("skips controls that are not rendered", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    const collapsed = document.createElement("div");
    collapsed.style.display = "none";
    collapsed.innerHTML = "<button>hidden</button>";
    const invisible = document.createElement("button");
    invisible.style.visibility = "hidden";
    editor().prepend(collapsed);
    editor().append(invisible);
    const items = tabbables().filter(
      (el) => el !== collapsed.firstElementChild && el !== invisible,
    );

    act(() => items[items.length - 1].focus());
    await user.keyboard("{Tab}");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(items[items.length - 1]).toHaveFocus();
  });

  it("leaves Tab alone for popups outside the dialog", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    act(() => outside.focus());
    await user.keyboard("{Tab}");

    expect(editor().contains(document.activeElement)).toBe(false);
  });
});

describe("Recurring dialog focus", () => {
  const openDeleteDialog = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText("Daily standup");
    focusGrid();
    // Daily standup starts at 8:00 on the Wednesday
    await user.keyboard("{PageUp}{PageUp}{Enter}{Delete}");
    return screen.findByRole("alertdialog");
  };

  it("gives focus back to the grid when the dialog is cancelled", async () => {
    const { user } = renderCalendar({
      events: [
        buildRecurringEvent({
          start: today.plus({ hours: 8 }),
          end: today.plus({ hours: 9 }),
        }),
      ],
    });
    await openDeleteDialog(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(grid()).toHaveFocus());
  });

  it("gives focus back to the grid when the dialog is confirmed", async () => {
    const { user } = renderCalendar({
      events: [
        buildRecurringEvent({
          start: today.plus({ hours: 8 }),
          end: today.plus({ hours: 9 }),
        }),
      ],
    });
    await openDeleteDialog(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(grid()).toHaveFocus());
  });

  it("returns to keyboard mode when the dialog was opened and closed with the keyboard", async () => {
    const { user } = renderCalendar({
      events: [
        buildRecurringEvent({
          start: today.plus({ hours: 8 }),
          end: today.plus({ hours: 9 }),
        }),
      ],
    });
    await openDeleteDialog(user);
    await user.keyboard("{Tab}{Tab}{Enter}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(grid()).toHaveFocus());
    expect(grid()).toHaveAttribute("data-keyboard-mode");
  });

  it("leaves focus alone when the element that had it is gone", async () => {
    const { user } = renderCalendar({
      events: [
        buildRecurringEvent({
          start: today.plus({ hours: 8 }),
          end: today.plus({ hours: 9 }),
        }),
      ],
    });
    await screen.findByText("Daily standup");
    focusGrid();
    await user.keyboard("{PageUp}{PageUp}{Enter}{Enter}{Enter}");
    await screen.findByRole("dialog", { name: "Edit event" });
    await user.click(screen.getByRole("button", { name: "Delete event" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(grid()).toHaveFocus());
    expect(getLastSavedEvents).toBeDefined();
  });
});

describe("Event editor focus: details", () => {
  const openSync = () => {
    focusGrid();
    for (const key of ["PageUp", "Enter", "Enter", "Enter"])
      fireEvent.keyDown(grid(), { key });
  };

  it("focuses the title as soon as the editor opens", async () => {
    renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    openSync();

    expect(screen.getByDisplayValue("Planning")).toHaveFocus();
  });

  it("does not pull focus back from another field of the editor", async () => {
    renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    openSync();
    const description = editor().querySelector("textarea")!;
    act(() => description.focus());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(description).toHaveFocus();
  });

  it("returns focus when the editor closes with focus on the page background", async () => {
    renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    openSync();
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.keyDown(document.body, { key: "Escape" });

    await expectBackOnEvent();
  });

  it("names the event when focus comes back", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    await user.keyboard("{Escape}");
    await expectBackOnEvent();

    expect(spoken()).toBe("Planning, Wednesday 18 March, 9 to 10 AM");
  });

  it("stays in pointer terms after a click on the page background closed it", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() => grid().focus());

    expect(grid()).not.toHaveAttribute("data-keyboard-mode");
  });

  it("does not wrap Shift+Tab from the last control", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    const items = Array.from(
      editor().querySelectorAll<HTMLElement>("button:not([disabled]), input"),
    ).filter((el) => el.getAttribute("tabindex") !== "-1");
    const last = items[items.length - 1];
    act(() => last.focus());
    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(items[0]).not.toHaveFocus();
    expect(last).not.toHaveFocus();
    expect(editor().contains(document.activeElement)).toBe(true);
  });

  it("does not enter keyboard mode when a pointer-opened editor closes over a focused grid", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    await user.click(grid());
    await openEventEditor(user, "Planning");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(grid()).not.toHaveAttribute("data-keyboard-mode");
    expect(spoken()).toBe("");
  });

  it("enters keyboard mode even when the browser does not call the restored focus keyboard focus", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    const original = Element.prototype.matches;
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      return selector === ":focus-visible"
        ? false
        : original.call(this, selector);
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await expectBackOnEvent();
  });

  it("puts focus back where it was when a context menu closes without opening the editor", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await screen.findByText("Planning");
    await user.click(grid());
    await openEventMenu(user, "Planning");
    await screen.findByRole("menuitem", { name: /edit/i });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(grid()).toHaveFocus());
  });

  it("names the event when a mouse click on Save gives focus back", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await expectBackOnEvent();

    expect(spoken()).toBe("Planning, Wednesday 18 March, 9 to 10 AM");
  });

  it("scrolls the slot into view when focus comes back", async () => {
    const scrollTo = vi.fn();
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openFromKeyboard(user);
    grid().scrollTo = scrollTo;
    grid().scrollTop = 0;
    Object.defineProperty(grid(), "clientHeight", { value: 100 });
    await user.keyboard("{Escape}");
    await expectBackOnEvent();

    // 9:30 sits 570px down, a 100px viewport minus the 48px header ends at 52px
    expect(scrollTo).toHaveBeenCalledWith({ top: 523, behavior: "smooth" });
  });
});
