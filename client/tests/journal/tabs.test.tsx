import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNote,
  dragAt,
  dragStart,
  plusButton,
  renderJournal,
  resetJournal,
  tabList,
  treeItem,
} from "./helpers.tsx";

afterEach(resetJournal);

describe("journal tabs and splits", () => {
  it("opens notes in the current tab on click and a new tab on middle click, closes on middle click", async () => {
    const user = userEvent.setup();
    renderJournal();

    await createNote(user, "One");
    await createNote(user, "Two");
    await createNote(user, "Three");
    await user.click(screen.getByLabelText("Close Three"));
    await user.click(screen.getByLabelText("Close Two"));

    await user.click(treeItem("Two"));
    expect(screen.queryByLabelText("Close One")).toBeNull();
    expect(screen.getByLabelText("Close Two")).toBeTruthy();

    fireEvent(
      treeItem("Three"),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(screen.getByLabelText("Close Two")).toBeTruthy();
    expect(screen.getByLabelText("Close Three")).toBeTruthy();

    fireEvent(
      within(tabList()).getByRole("tab", { name: "Three" }),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(screen.queryByLabelText("Close Three")).toBeNull();
  });
  it("opens a dragged note in a split and shows a preview first", async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 100),
    );
    renderJournal();

    await createNote(user, "Left");
    await createNote(user, "Right");
    await user.click(screen.getByLabelText("Close Right"));

    await dragStart(treeItem("Right"));
    const overlay = screen.getByTestId("drop-overlay");
    dragAt("dragOver", overlay, 95, 50);
    expect(overlay.firstElementChild).toBeTruthy();

    dragAt("drop", overlay, 95, 50);
    await waitFor(() =>
      expect(
        screen.getAllByRole("tablist", { name: "Open notes" }),
      ).toHaveLength(2),
    );
    const [first, second] = screen.getAllByRole("tablist", {
      name: "Open notes",
    });
    expect(within(first).getByText("Left")).toBeTruthy();
    expect(within(second).getByText("Right")).toBeTruthy();
  });
  it("only accepts notes on the editor and ignores no-op tab drops", async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.keyboard("Docs{Enter}");
    await createNote(user, "Solo");

    await dragStart(treeItem("Docs"));
    expect(screen.queryByTestId("drop-overlay")).toBeNull();
    fireEvent.dragEnd(treeItem("Docs"));

    await dragStart(within(tabList()).getByText("Solo").closest("li")!);
    const overlay = screen.getByTestId("drop-overlay");
    expect(dragAt("dragOver", overlay, 50, 50)).toBe(true);
    expect(dragAt("dragOver", overlay, 95, 50)).toBe(true);
  });
  it("moves an empty tab to a split", async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 100),
    );
    renderJournal();

    await createNote(user, "Left");
    await user.click(plusButton());
    await dragStart(
      within(tabList()).getByText("New tab").closest("li")!,
    );
    const overlays = screen.getAllByTestId("drop-overlay");
    dragAt("drop", overlays[0], 95, 50);

    await waitFor(() =>
      expect(
        screen.getAllByRole("tablist", { name: "Open notes" }),
      ).toHaveLength(2),
    );
    const [first, second] = screen.getAllByRole("tablist", {
      name: "Open notes",
    });
    expect(within(first).getByText("Left")).toBeTruthy();
    expect(within(second).getByText("New tab")).toBeTruthy();
  });
  it("moves a tab to another split and reorders tabs", async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 100),
    );
    renderJournal();

    await createNote(user, "A");
    await createNote(user, "B");

    const tab = (name: string) =>
      within(tabList()).getByRole("tab", { name }).closest("li")!;
    await dragStart(tab("B"));
    dragAt("dragOver", tabList(), 0, 0);
    dragAt("drop", tabList(), 0, 0);
    const names = () =>
      within(tabList())
        .getAllByRole("tab", { name: /^[AB]$/ })
        .map((b) => b.textContent);
    expect(names()).toEqual(["B", "A"]);

    await dragStart(tab("A"));
    dragAt("dragOver", screen.getByTestId("drop-overlay"), 5, 50);
    dragAt("drop", screen.getByTestId("drop-overlay"), 5, 50);
    await waitFor(() =>
      expect(
        screen.getAllByRole("tablist", { name: "Open notes" }),
      ).toHaveLength(2),
    );

    const lists = screen.getAllByRole("tablist", { name: "Open notes" });
    await dragStart(within(lists[0]).getByText("A").closest("li")!);
    dragAt("dragOver", lists[1], 200, 0);
    dragAt("drop", lists[1], 200, 0);
    await waitFor(() =>
      expect(
        screen.getAllByRole("tablist", { name: "Open notes" }),
      ).toHaveLength(1),
    );
    expect(names()).toEqual(["B", "A"]);
  });
  it("adds an empty tab with the plus button that the next opened note replaces", async () => {
    const user = userEvent.setup();
    renderJournal();

    await createNote(user, "One");
    await user.click(plusButton());
    expect(
      within(tabList()).getByRole("tab", { name: "New tab", selected: true }),
    ).toBeTruthy();
    expect(screen.getByText(/to start writing/)).toBeTruthy();

    await user.click(screen.getByLabelText("Close One"));
    await user.click(screen.getByLabelText("Close New tab"));
    await user.click(plusButton());
    await user.click(treeItem("One"));
    expect(
      within(tabList()).queryByRole("tab", { name: "New tab" }),
    ).toBeNull();
    expect(within(tabList()).getByRole("tab", { name: "One" })).toBeTruthy();
  });
  it("creates a note straight from the empty tab", async () => {
    const user = userEvent.setup();
    renderJournal();

    await user.click(plusButton());
    await user.click(screen.getByRole("button", { name: "create" }));

    expect(screen.getByRole("textbox", { name: "Title" })).toHaveProperty(
      "value",
      "Untitled",
    );
    expect(
      within(tabList()).queryByRole("tab", { name: "New tab" }),
    ).toBeNull();
    expect(treeItem("Untitled")).toBeTruthy();
  });
  it("closes a tab with a middle click on its x and only shows the x on hover", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Gone");

    const close = screen.getByLabelText("Close Gone");
    expect(close.className).toContain("opacity-0");
    expect(close.className).toContain("group-hover:opacity-80");
    expect(close.className).toContain("hover:group-hover:opacity-100");

    fireEvent(close, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(screen.queryByLabelText("Close Gone")).toBeNull();
  });
});
