import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoViolations } from "../a11y/axe.ts";
import { panesOf } from "../../src/lib/journal/layout.ts";
import {
  journal,
  renderLoadedJournal,
  resetJournal,
  tabList,
} from "./helpers.tsx";

afterEach(resetJournal);

const openTabs = (...names: string[]) =>
  act(() => {
    for (const name of names) {
      const id = journal.addItem("note", null);
      journal.renameItem(id, name);
      journal.openNote(id, true);
    }
  });

const tab = (name: string, list: HTMLElement = tabList()) =>
  within(list).getByRole("tab", { name });

const focus = (element: HTMLElement) => act(() => element.focus());

const focused = () => document.activeElement as HTMLElement;

const splitRight = (name: string, paneIndex: number) =>
  act(() => {
    const pane = panesOf(journal.workspace.layout)[paneIndex].id;
    const id = journal.items.find((item) => item.name === name)!.id;
    journal.dropOnPane(pane, "right", { id, fromPane: pane });
  });

const lists = () => screen.getAllByRole("tablist", { name: "Open notes" });

describe("journal tab keyboard", () => {
  it("is a tablist of tabs with one tab stop on the selected tab", async () => {
    await renderLoadedJournal();
    openTabs("One", "Two", "Three");

    expect(within(tabList()).getAllByRole("tab")).toHaveLength(3);
    expect(tab("Three").getAttribute("aria-selected")).toBe("true");
    expect(tab("One").getAttribute("aria-selected")).toBe("false");
    expect(tab("Three").tabIndex).toBe(0);
    expect(tab("One").tabIndex).toBe(-1);
    expect(tab("Two").tabIndex).toBe(-1);
  });

  it("keeps the close buttons out of the tab order and the accessibility tree", async () => {
    await renderLoadedJournal();
    openTabs("One");

    const close = screen.getByLabelText("Close One");
    expect(close.tabIndex).toBe(-1);
    expect(close.getAttribute("aria-hidden")).toBe("true");
  });

  it("switches tabs with Left and Right, wrapping around", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    openTabs("One", "Two", "Three");
    focus(tab("Three"));

    await user.keyboard("{ArrowLeft}");
    expect(tab("Two").getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(focused()).toBe(tab("Two")));

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    await waitFor(() => expect(focused()).toBe(tab("Three")));
    expect(tab("Three").getAttribute("aria-selected")).toBe("true");

    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(focused()).toBe(tab("One")));
    expect(tab("One").getAttribute("aria-selected")).toBe("true");
  });

  it("activates a focused tab with Enter and Space", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    openTabs("One", "Two");

    focus(tab("One"));
    await user.keyboard("{Enter}");
    expect(tab("One").getAttribute("aria-selected")).toBe("true");

    focus(tab("Two"));
    await user.keyboard(" ");
    expect(tab("Two").getAttribute("aria-selected")).toBe("true");
  });

  it("closes the focused tab with Delete or Backspace and focuses its neighbor", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    openTabs("One", "Two", "Three");
    focus(tab("Three"));

    await user.keyboard("{Delete}");
    await waitFor(() => expect(focused()).toBe(tab("Two")));
    expect(screen.queryByRole("tab", { name: "Three" })).toBeNull();

    await user.keyboard("{Backspace}");
    await waitFor(() => expect(focused()).toBe(tab("One")));
    expect(screen.queryByRole("tab", { name: "Two" })).toBeNull();
  });

  it("focuses the new tab button after closing the last tab", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    openTabs("Only");
    focus(tab("Only"));

    await user.keyboard("{Delete}");

    await waitFor(() =>
      expect(focused()).toBe(
        screen.getAllByRole("button", { name: "New tab" })[0],
      ),
    );
  });

  it.each([
    ["Shift+F10", "{Shift>}{F10}{/Shift}"],
    ["the ContextMenu key", "{ContextMenu}"],
    ["M", "m"],
  ])("opens the tab menu with %s", async (_, keys) => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    openTabs("One", "Two");
    focus(tab("Two"));

    await user.keyboard(keys);

    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Move to a new pane on the left",
      "Move to a new pane on the right",
      "Move to a new pane above",
      "Move to a new pane below",
      "Close Two",
    ]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(focused()).toBe(tab("Two"));
  });

  it("ignores tab keys combined with Ctrl, Alt or Meta and keys it does not use", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    openTabs("One", "Two");
    focus(tab("Two"));

    for (const modifier of ["Control", "Alt", "Meta"]) {
      await user.keyboard(`{${modifier}>}{ArrowLeft}{/${modifier}}`);
      expect(tab("Two").getAttribute("aria-selected")).toBe("true");
    }
    await user.keyboard("{F10}{Shift>}M{/Shift}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(fireEvent.keyDown(tab("Two"), { key: "a" })).toBe(true);
    expect(fireEvent.keyDown(tab("Two"), { key: "ArrowLeft" })).toBe(false);
  });

  it("only offers closing for the single tab of the single pane", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    openTabs("Only");
    focus(tab("Only"));

    await user.keyboard("m");

    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Close Only"]);
  });

  it("moves a tab to a new split with M and focuses it there", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    openTabs("One", "Two");
    focus(tab("Two"));

    await user.keyboard("m");
    await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(lists()).toHaveLength(2));
    const moved = tab("Two", lists()[1]);
    await waitFor(() => expect(focused()).toBe(moved));
    expect(tab("One", lists()[0])).toBeTruthy();
    expect(journal.workspace.focused).toBe(
      panesOf(journal.workspace.layout)[1].id,
    );
  });

  it("moves a tab to another pane by number", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    openTabs("One", "Two", "Three");
    splitRight("Three", 0);
    await waitFor(() => expect(lists()).toHaveLength(2));
    focus(tab("Three", lists()[1]));

    await user.keyboard("m");
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Move to pane 1", "Close Three"]);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(lists()).toHaveLength(1));
    await waitFor(() => expect(focused()).toBe(tab("Three")));
    expect(
      within(tabList())
        .getAllByRole("tab")
        .map((item) => item.textContent),
    ).toEqual(["One", "Two", "Three"]);
  });

  it("closes a tab from the tab menu", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    openTabs("One", "Two");
    focus(tab("Two"));

    await user.keyboard("m");
    await screen.findByRole("menu");
    await user.keyboard("{End}{Enter}");

    await waitFor(() =>
      expect(screen.queryByRole("tab", { name: "Two" })).toBeNull(),
    );
  });

  describe("between panes", () => {
    const setup = async () => {
      await renderLoadedJournal();
      openTabs("One", "Two", "Three");
      splitRight("Three", 0);
      await waitFor(() => expect(lists()).toHaveLength(2));
      splitRight("Two", 0);
      await waitFor(() => expect(lists()).toHaveLength(3));
    };

    it("cycles the focus with F6 and Shift+F6 and focuses the pane", async () => {
      const user = userEvent.setup();
      await setup();
      const panes = () => panesOf(journal.workspace.layout);
      focus(tab("One", lists()[0]));
      expect(journal.workspace.focused).toBe(panes()[0].id);

      await user.keyboard("{F6}");
      await waitFor(() => expect(focused()).toBe(tab("Two", lists()[1])));
      expect(journal.workspace.focused).toBe(panes()[1].id);

      await user.keyboard("{F6}{F6}");
      await waitFor(() => expect(focused()).toBe(tab("One", lists()[0])));

      await user.keyboard("{Shift>}{F6}{/Shift}");
      await waitFor(() => expect(focused()).toBe(tab("Three", lists()[2])));
      await user.keyboard("{Shift>}{F6}{/Shift}");
      await waitFor(() => expect(focused()).toBe(tab("Two", lists()[1])));
    });

    it("numbers the other panes in the tab menu", async () => {
      const user = userEvent.setup();
      await setup();
      focus(tab("One", lists()[0]));

      await user.keyboard("m");

      const menu = await screen.findByRole("menu");
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item) => item.textContent)
          .filter((text) => text?.startsWith("Move to pane")),
      ).toEqual(["Move to pane 2", "Move to pane 3"]);
    });

    it("handles F6 itself so the browser does not", async () => {
      await setup();
      focus(tab("One", lists()[0]));

      expect(fireEvent.keyDown(focused(), { key: "F6" })).toBe(false);
    });

    it("leaves F6 alone when the focused element already handled it", async () => {
      const user = userEvent.setup();
      await setup();
      const handle = screen.getAllByRole("separator")[0];
      expect(handle.getAttribute("aria-label")).toBe("Resize panes");
      handle.addEventListener("keydown", (e) => e.preventDefault());
      focus(handle);

      await user.keyboard("{F6}");

      expect(focused()).toBe(handle);
    });

    it("focuses a pane when keyboard focus enters it", async () => {
      await setup();
      const panes = panesOf(journal.workspace.layout);
      expect(journal.workspace.focused).toBe(panes[1].id);

      focus(tab("One", lists()[0]));
      expect(journal.workspace.focused).toBe(panes[0].id);
    });

    it("leaves F6 alone with a single pane", async () => {
      await renderLoadedJournal();
      openTabs("One");
      focus(tab("One"));

      const notHandled = fireEvent.keyDown(focused(), { key: "F6" });

      expect(notHandled).toBe(true);
    });

    it("has no accessibility violations with splits and an open tab menu", async () => {
      const user = userEvent.setup();
      const { container } = await renderLoadedJournal();
      openTabs("One", "Two");
      splitRight("Two", 0);
      await waitFor(() => expect(lists()).toHaveLength(2));
      await expectNoViolations(container, ["aria-required-attr"]);

      focus(tab("One", lists()[0]));
      await user.keyboard("m");
      await screen.findByRole("menu");
      await expectNoViolations(document.body, ["region", "aria-required-attr"]);
    });
  });
});
