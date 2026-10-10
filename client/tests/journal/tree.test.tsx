import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNote,
  dataTransfer,
  dragStart,
  journal,
  renderJournal,
  resetJournal,
  tabList,
  treeItem,
} from "./helpers.tsx";

afterEach(resetJournal);

describe("journal tree", () => {
  it("starts renaming a new folder but not a new note", async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole("button", { name: "New note" }));
    expect(screen.queryByLabelText("Rename")).toBeNull();

    await user.click(screen.getByRole("button", { name: "New folder" }));
    expect(screen.getByLabelText("Rename")).toBeTruthy();
  });

  it("shows the expand and collapse button only when there are folders", async () => {
    const user = userEvent.setup();
    renderJournal();
    const toggle = () =>
      screen.queryByRole("button", { name: /^(Expand|Collapse) all$/ });

    await user.click(screen.getByRole("button", { name: "New note" }));
    expect(toggle()).toBeNull();

    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.keyboard("{Enter}");
    expect(toggle()).toBeTruthy();
  });

  it("restores an untitled name when the title is left empty", async () => {
    const user = userEvent.setup();
    renderJournal();

    await createNote(user, "Named");
    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.tab();

    expect(screen.getByLabelText("Close Untitled")).toBeTruthy();
  });
  it("keeps the modified time when the title is left unchanged", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Stable");
    const before = journal.items[0].updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await user.click(screen.getByRole("textbox", { name: "Title" }));
    await user.tab();

    expect(journal.items[0].updatedAt).toBe(before);
  });
  it("separates the sort groups in the sort menu", async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole("button", { name: "Change sort order" }));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(6);
    expect(within(menu).getAllByRole("separator")).toHaveLength(2);
  });
  it("deletes a folder with its notes after confirmation", async () => {
    const user = userEvent.setup();
    renderJournal();

    await createNote(user, "Keep");
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.keyboard("Docs{Enter}");
    await user.click(treeItem("Docs"));
    await createNote(user, "Inside");
    expect(screen.getByLabelText("Close Inside")).toBeTruthy();

    fireEvent.contextMenu(treeItem("Docs"));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText('Delete "Docs"?')).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(treeItem("Docs")).toBeTruthy();

    fireEvent.contextMenu(treeItem("Docs"));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    expect(screen.queryByRole("treeitem", { name: "Docs" })).toBeNull();
    expect(screen.queryByLabelText("Close Inside")).toBeNull();
    expect(within(tabList()).getByRole("tab", { name: "Keep" })).toBeTruthy();
  });
  it("deletes an empty folder without confirmation", async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.keyboard("Empty{Enter}");
    fireEvent.contextMenu(treeItem("Empty"));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("treeitem", { name: "Empty" })).toBeNull();
  });
  it("filters the tree with search", async () => {
    const user = userEvent.setup();
    renderJournal();

    await createNote(user, "Alpha");
    await createNote(user, "Beta");
    await user.click(screen.getByRole("button", { name: "Search notes" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search notes" }),
      "alp",
    );

    expect(treeItem("Alpha")).toBeTruthy();
    expect(
      within(screen.getByRole("navigation", { name: "Notes" })).queryByRole(
        "treeitem",
        { name: "Beta" },
      ),
    ).toBeNull();
  });
  it("moves items into and out of folders by dragging", async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.keyboard("Docs{Enter}");
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.keyboard("Sub{Enter}");
    await user.click(treeItem("Docs"));
    await createNote(user, "Moved");
    expect(treeItem("Docs").getAttribute("aria-expanded")).toBe("true");

    const tree = screen.getByRole("navigation", { name: "Notes" });
    await dragStart(treeItem("Moved"));
    fireEvent.dragOver(treeItem("Sub"), { dataTransfer: dataTransfer() });
    fireEvent.drop(treeItem("Sub"), { dataTransfer: dataTransfer() });
    expect(
      within(treeItem("Sub").closest("li")!).getByRole("treeitem", {
        name: "Moved",
      }),
    ).toBeTruthy();

    await dragStart(treeItem("Moved"));
    fireEvent.drop(tree.parentElement!, { dataTransfer: dataTransfer() });
    expect(
      within(treeItem("Sub").closest("li")!).queryByRole("treeitem", {
        name: "Moved",
      }),
    ).toBeNull();
    expect(treeItem("Moved")).toBeTruthy();
  });
  it("does not move a note when its tab is dropped on the tree", async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.keyboard("Docs{Enter}");
    await createNote(user, "Tabbed");

    await dragStart(screen.getByRole("tab", { name: "Tabbed" }).closest("li")!);
    const prevented = !fireEvent.dragOver(treeItem("Docs"), {
      dataTransfer: dataTransfer(),
    });
    fireEvent.drop(treeItem("Docs"), { dataTransfer: dataTransfer() });
    fireEvent.drop(screen.getByRole("navigation", { name: "Notes" }).parentElement!, {
      dataTransfer: dataTransfer(),
    });

    expect(prevented).toBe(false);
    expect(journal.items.find((item) => item.name === "Tabbed")?.parentId).toBeNull();
  });
  it("does not drop a folder into its own subtree", async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.keyboard("Outer{Enter}");
    await user.click(treeItem("Outer"));
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.keyboard("Inner{Enter}");

    await dragStart(treeItem("Outer"));
    const over = fireEvent.dragOver(treeItem("Inner"), {
      dataTransfer: dataTransfer(),
    });
    expect(over).toBe(true);
    fireEvent.drop(treeItem("Inner"), { dataTransfer: dataTransfer() });
    expect(treeItem("Outer")).toBeTruthy();
    expect(
      within(treeItem("Inner").closest("li")!).queryByRole("treeitem", {
        name: "Outer",
      }),
    ).toBeNull();
  });
  it("titles the context menu with the note name and copies its id", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderJournal();
    await createNote(user, "Menu note");

    fireEvent.contextMenu(treeItem("Menu note"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Menu note")).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "Copy ID" }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });
  it("gives every toolbar button a tooltip", async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.hover(screen.getByRole("button", { name: "New note" }));
    expect(await screen.findByRole("tooltip")).toHaveProperty(
      "textContent",
      "New note",
    );
  });

  it("keeps the outline items while only the content changes", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Typing");
    const before = journal.items;

    act(() => journal.setContent(before[0].id, "hello"));
    expect(journal.items).toBe(before);

    act(() => journal.renameItem(before[0].id, "Renamed"));
    expect(journal.items).not.toBe(before);
  });
});
