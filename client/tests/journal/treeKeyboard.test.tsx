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
import {
  journal,
  renderLoadedJournal,
  resetJournal,
  tabList,
  treeItem,
} from "./helpers.tsx";

afterEach(resetJournal);

const add = (
  type: "note" | "folder",
  name: string,
  parentId: string | null = null,
) => {
  let id = "";
  act(() => {
    id = journal.addItem(type, parentId);
    journal.renameItem(id, name);
  });
  return id;
};

const focus = (name: string) => act(() => treeItem(name).focus());

const focused = () => document.activeElement as HTMLElement;

const seedTree = () => {
  const docs = add("folder", "Docs");
  const sub = add("folder", "Sub", docs);
  add("note", "Inner", sub);
  add("note", "Plain");
};

describe("journal tree keyboard", () => {
  it("is a tree of treeitems with levels, expanded and selected state", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    seedTree();
    await user.click(treeItem("Plain"));

    const tree = screen.getByRole("tree", { name: "Notes" });
    expect(within(tree).getAllByRole("treeitem")).toHaveLength(4);
    expect(within(tree).getAllByRole("group")).toHaveLength(2);
    expect(treeItem("Docs").getAttribute("aria-level")).toBe("1");
    expect(treeItem("Sub").getAttribute("aria-level")).toBe("2");
    expect(treeItem("Inner").getAttribute("aria-level")).toBe("3");
    expect(treeItem("Docs").getAttribute("aria-expanded")).toBe("true");
    expect(treeItem("Plain").hasAttribute("aria-expanded")).toBe(false);
    expect(treeItem("Plain").getAttribute("aria-selected")).toBe("true");
    expect(treeItem("Docs").getAttribute("aria-selected")).toBe("false");
  });

  it("has a single tab stop that follows the focused row", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    seedTree();

    const stops = () =>
      screen
        .getAllByRole("treeitem")
        .filter((item) => item.tabIndex === 0)
        .map((item) => item.textContent);
    expect(stops()).toEqual(["Docs"]);

    await user.click(screen.getByRole("button", { name: "New note" }));
    await user.keyboard("{Escape}");
    focus("Plain");
    expect(stops()).toEqual(["Plain"]);
  });

  it("uses the open note as the tab stop before any row was focused", async () => {
    await renderLoadedJournal();
    seedTree();
    act(() =>
      journal.openNote(journal.items.find((item) => item.name === "Plain")!.id),
    );

    const stops = screen
      .getAllByRole("treeitem")
      .filter((item) => item.tabIndex === 0);
    expect(stops).toEqual([treeItem("Plain")]);
  });

  it("moves focus with the arrow keys, Home and End", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    seedTree();
    focus("Docs");

    await user.keyboard("{ArrowDown}");
    expect(focused()).toBe(treeItem("Sub"));
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(focused()).toBe(treeItem("Plain"));
    await user.keyboard("{ArrowDown}");
    expect(focused()).toBe(treeItem("Plain"));
    await user.keyboard("{ArrowUp}");
    expect(focused()).toBe(treeItem("Inner"));
    await user.keyboard("{Home}");
    expect(focused()).toBe(treeItem("Docs"));
    await user.keyboard("{End}");
    expect(focused()).toBe(treeItem("Plain"));
  });

  it("expands with Right, enters the folder, and goes back with Left", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    seedTree();
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(treeItem("Docs").getAttribute("aria-expanded")).toBe("false");
    focus("Docs");

    await user.keyboard("{ArrowRight}");
    expect(treeItem("Docs").getAttribute("aria-expanded")).toBe("true");
    expect(focused()).toBe(treeItem("Docs"));

    await user.keyboard("{ArrowRight}");
    expect(focused()).toBe(treeItem("Sub"));

    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(focused()).toBe(treeItem("Inner"));
    await user.keyboard("{ArrowLeft}");
    expect(focused()).toBe(treeItem("Sub"));

    await user.keyboard("{ArrowLeft}");
    expect(treeItem("Sub").getAttribute("aria-expanded")).toBe("false");
    await user.keyboard("{ArrowLeft}");
    expect(focused()).toBe(treeItem("Docs"));
    await user.keyboard("{ArrowLeft}");
    expect(treeItem("Docs").getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps Right on a note and Left on a root note in place", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    add("note", "Solo");
    focus("Solo");

    await user.keyboard("{ArrowRight}{ArrowLeft}");

    expect(focused()).toBe(treeItem("Solo"));
  });

  it("ignores arrow keys combined with Ctrl, Alt or Meta", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    seedTree();
    focus("Docs");

    for (const modifier of ["Control", "Alt", "Meta"]) {
      await user.keyboard(`{${modifier}>}{ArrowDown}{/${modifier}}`);
      expect(focused()).toBe(treeItem("Docs"));
    }
  });

  it("only handles the keys it uses", async () => {
    await renderLoadedJournal();
    seedTree();
    focus("Docs");

    expect(fireEvent.keyDown(treeItem("Docs"), { key: "ArrowDown" })).toBe(
      false,
    );
    expect(fireEvent.keyDown(treeItem("Docs"), { key: "a" })).toBe(true);
    expect(fireEvent.keyDown(treeItem("Docs"), { key: "F10" })).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not open the move menu for Shift+M", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    seedTree();
    focus("Plain");

    await user.keyboard("{Shift>}M{/Shift}");

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps Right on an empty folder and on a note from toggling anything", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    add("folder", "Empty");
    add("note", "Plain");
    focus("Empty");

    await user.keyboard("{ArrowRight}");
    expect(treeItem("Empty").getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{ArrowRight}");
    expect(focused()).toBe(treeItem("Empty"));

    focus("Plain");
    const before = journal.expanded;
    await user.keyboard("{ArrowRight}");
    expect(journal.expanded).toBe(before);
  });

  it("goes to the parent instead of collapsing while searching", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    seedTree();
    await user.click(screen.getByRole("button", { name: "Search notes" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search notes" }),
      "Inner",
    );
    const before = journal.expanded;
    focus("Sub");

    await user.keyboard("{ArrowLeft}");

    expect(focused()).toBe(treeItem("Docs"));
    expect(journal.expanded).toBe(before);
  });

  it("opens a note with Enter and toggles a folder with Space", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    seedTree();
    focus("Plain");

    await user.keyboard("{Enter}");
    expect(within(tabList()).getByRole("tab", { name: "Plain" })).toBeTruthy();

    focus("Docs");
    await user.keyboard(" ");
    expect(treeItem("Docs").getAttribute("aria-expanded")).toBe("false");
    await user.keyboard("{Enter}");
    expect(treeItem("Docs").getAttribute("aria-expanded")).toBe("true");
  });

  it("opens the item menu with Shift+F10 and the ContextMenu key", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    add("note", "Menu");
    focus("Menu");

    await user.keyboard("{Shift>}{F10}{/Shift}");
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(focused()).toBe(treeItem("Menu"));

    await user.keyboard("{ContextMenu}");
    expect(await screen.findByRole("menu")).toBeTruthy();
  });

  it("renames with F2 and returns focus to the renamed row", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    add("note", "Old");
    focus("Old");

    await user.keyboard("{F2}");
    const input = await screen.findByRole("textbox", { name: "Rename" });
    await waitFor(() => expect(focused()).toBe(input));
    await user.keyboard("Fresh{Enter}");

    await waitFor(() => expect(focused()).toBe(treeItem("Fresh")));
  });

  it("does not take the focus back when a rename ends by clicking another row", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    add("note", "First");
    add("note", "Second");
    focus("First");

    await user.keyboard("{F2}");
    await screen.findByRole("textbox", { name: "Rename" });
    await user.click(treeItem("Second"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(focused()).toBe(treeItem("Second"));
  });

  it("keeps focus where it is when a rename is cancelled", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    add("note", "Keep");
    focus("Keep");

    await user.keyboard("{F2}");
    await screen.findByRole("textbox", { name: "Rename" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(focused()).toBe(treeItem("Keep")));
  });

  it("focuses a new folder's row once it is named", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();

    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.keyboard("Created{Enter}");

    await waitFor(() => expect(focused()).toBe(treeItem("Created")));
  });

  it("deletes with Delete and focuses the next row, or the previous one at the end", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    seedTree();

    focus("Docs");
    await user.keyboard("{Delete}");
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() => expect(focused()).toBe(treeItem("Plain")));
    expect(screen.queryByRole("treeitem", { name: "Docs" })).toBeNull();
    expect(screen.queryByRole("treeitem", { name: "Inner" })).toBeNull();

    add("note", "Zed");
    focus("Zed");
    await user.keyboard("{Delete}");
    await waitFor(() => expect(focused()).toBe(treeItem("Plain")));
  });

  it("deletes through the item menu and focuses the next row", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    add("note", "A");
    add("note", "B");

    fireEvent.contextMenu(treeItem("A"));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    await waitFor(() => expect(focused()).toBe(treeItem("B")));
  });

  it("opens the item menu with M and moves through its Move to entry", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    seedTree();
    add("folder", "Other");
    focus("Inner");

    await user.keyboard("m");
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Rename", "Copy ID", "Move to", "Open in new pane", "Delete"]);

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}");
    const items = within(screen.getAllByRole("menu").at(-1)!).getAllByRole(
      "menuitem",
    );
    expect(items.map((item) => item.textContent)).toEqual([
      "Root",
      "Docs",
      "Other",
    ]);
    expect(items[1].style.paddingInlineStart).toBe("20px");

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    const other = treeItem("Other").closest("li")!;
    expect(within(other).getByRole("treeitem", { name: "Inner" })).toBeTruthy();
    await waitFor(() => expect(focused()).toBe(treeItem("Inner")));
  });

  it("closes the item menu opened with M on Escape and focuses the row again", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    seedTree();
    focus("Plain");

    await user.keyboard("m");
    await screen.findByRole("menu");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(
      journal.itemsById.get(journal.items.find((i) => i.name === "Plain")!.id)!
        .parentId,
    ).toBeNull();
    await waitFor(() => expect(focused()).toBe(treeItem("Plain")));
  });

  it("leaves out Move to for an item with nowhere to go", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    add("note", "Alone");
    focus("Alone");

    await user.keyboard("m");

    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Rename", "Copy ID", "Open in new pane", "Delete"]);
  });

  it("moves through the Move to entry of the item menu", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    add("folder", "Docs");
    add("note", "Loose");
    focus("Loose");

    await user.keyboard("{Shift>}{F10}{/Shift}");
    await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}");
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(focused()).toBe(treeItem("Loose")));
    const docs = treeItem("Docs").closest("li")!;
    expect(within(docs).getByRole("treeitem", { name: "Loose" })).toBeTruthy();
  });

  it("opens a note in a new split from the item menu", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    add("note", "One");
    add("note", "Two");
    await user.click(treeItem("One"));
    focus("Two");

    await user.keyboard("{Shift>}{F10}{/Shift}");
    await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}");
    expect(
      screen.getByRole("menuitem", { name: "Move to a new pane on the left" }),
    ).toBeTruthy();
    await user.keyboard("{ArrowDown}{Enter}");

    const lists = await screen.findAllByRole("tablist", {
      name: "Open notes",
    });
    expect(lists).toHaveLength(2);
    const moved = within(lists[1]).getByRole("tab", { name: "Two" });
    await waitFor(() => expect(focused()).toBe(moved));
  });

  it("only offers Open in new pane for notes", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    add("folder", "Docs");
    add("note", "Note");

    focus("Docs");
    await user.keyboard("{Shift>}{F10}{/Shift}");
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).queryByRole("menuitem", { name: "Open in new pane" }),
    ).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    focus("Note");
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(
      await screen.findByRole("menuitem", { name: "Open in new pane" }),
    ).toBeTruthy();
  });

  it("tabs through the toolbar buttons, then the tree, with the tab stops named", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    seedTree();
    screen.getByRole("button", { name: "New note" }).focus();

    const names = [document.activeElement!.getAttribute("aria-label")];
    for (let i = 0; i < 5; i++) {
      await user.tab();
      const element = document.activeElement as HTMLElement;
      names.push(element.getAttribute("aria-label") ?? element.textContent);
    }

    expect(names).toEqual([
      "New note",
      "New folder",
      "Change sort order",
      "Collapse all",
      "Search notes",
      "Docs",
    ]);
  });

  it("has no accessibility violations with nested folders, tabs and an open menu", async () => {
    const user = userEvent.setup();
    const { container } = await renderLoadedJournal();
    seedTree();
    await user.click(treeItem("Plain"));
    await user.click(treeItem("Inner"));
    await expectNoViolations(container);

    focus("Docs");
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await screen.findByRole("menu");
    await expectNoViolations(document.body, ["region"]);
  });
});
