import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNote,
  renderJournal,
  resetJournal,
  tabList,
  treeItem,
} from "./helpers.tsx";

afterEach(resetJournal);

describe("journal on a touch screen", () => {
  describe("with a touch screen", () => {
    const touch = () =>
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query === "(pointer: coarse)",
        addEventListener: () => {},
        removeEventListener: () => {},
      }));

    it("replaces the context menu with a more button", async () => {
      touch();
      const user = userEvent.setup();
      renderJournal();
      await createNote(user, "Touchy");

      expect(fireEvent.contextMenu(treeItem("Touchy"))).toBe(false);
      expect(screen.queryByRole("menuitem")).toBeNull();
      expect(
        fireEvent.contextMenu(
          within(tabList()).getByRole("tab", { name: "Touchy" }),
        ),
      ).toBe(false);
      expect(screen.queryByRole("menu")).toBeNull();

      const more = screen.getByRole("button", { name: "More actions" });
      expect(more.querySelector(".lucide-ellipsis-vertical")).toBeTruthy();
      await user.click(more);
      expect(
        await screen.findByRole("menuitem", { name: "Rename" }),
      ).toBeTruthy();
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(screen.queryByRole("treeitem", { name: "Touchy" })).toBeNull();
    });

    it("keeps the rename field focused after choosing rename", async () => {
      touch();
      const user = userEvent.setup();
      renderJournal();
      await createNote(user, "Old");

      await user.click(screen.getByRole("button", { name: "More actions" }));
      await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
      const input = await screen.findByRole("textbox", { name: "Rename" });
      expect(document.activeElement).toBe(input);
      await user.keyboard("New{Enter}");
      expect(treeItem("New")).toBeTruthy();
    });

    it("moves a note into a folder from the more menu", async () => {
      touch();
      const user = userEvent.setup();
      renderJournal();
      await user.click(screen.getByRole("button", { name: "New folder" }));
      await user.keyboard("Docs{Enter}");
      await createNote(user, "Loose");

      const row = treeItem("Loose").closest("li")!;
      await user.click(
        within(row).getByRole("button", { name: "More actions" }),
      );
      await user.click(
        await screen.findByRole("menuitem", { name: "Move to" }),
      );
      fireEvent.click(await screen.findByRole("menuitem", { name: "Docs" }));

      const docs = treeItem("Docs").closest("li")!;
      await waitFor(() =>
        expect(
          within(docs).getByRole("treeitem", { name: "Loose" }),
        ).toBeTruthy(),
      );
    });

    it("opens a note in a split from the more menu", async () => {
      touch();
      const user = userEvent.setup();
      renderJournal();
      await createNote(user, "One");
      await createNote(user, "Two");

      const row = treeItem("Two").closest("li")!;
      await user.click(
        within(row).getByRole("button", { name: "More actions" }),
      );
      await user.click(
        await screen.findByRole("menuitem", { name: "Open in new pane" }),
      );
      fireEvent.click(
        await screen.findByRole("menuitem", {
          name: "Move to a new pane on the right",
        }),
      );

      await waitFor(() =>
        expect(
          screen.getAllByRole("tablist", { name: "Open notes" }),
        ).toHaveLength(2),
      );
    });

    it("moves the active tab from the tab actions menu", async () => {
      touch();
      const user = userEvent.setup();
      renderJournal();
      await createNote(user, "One");
      await createNote(user, "Two");

      await user.click(screen.getByRole("button", { name: "Tab actions" }));
      fireEvent.click(
        await screen.findByRole("menuitem", {
          name: "Move to a new pane on the right",
        }),
      );

      await waitFor(() =>
        expect(
          screen.getAllByRole("tablist", { name: "Open notes" }),
        ).toHaveLength(2),
      );
      const [, second] = screen.getAllByRole("tablist", { name: "Open notes" });
      expect(within(second).getByRole("tab", { name: "Two" })).toBeTruthy();
      expect(
        screen.getAllByRole("button", { name: "Tab actions" }),
      ).toHaveLength(2);
    });

    it("does not open a menu when a tab is long pressed", async () => {
      touch();
      const user = userEvent.setup();
      renderJournal();
      await createNote(user, "Held");

      fireEvent.pointerDown(
        within(tabList()).getByRole("tab", { name: "Held" }),
      );
      await act(() => new Promise((resolve) => setTimeout(resolve, 800)));

      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("has no tab actions button with a mouse", async () => {
      const user = userEvent.setup();
      renderJournal();
      await createNote(user, "Mouse");

      expect(screen.queryByRole("button", { name: "Tab actions" })).toBeNull();
    });
  });
  it("has no more button with a mouse", async () => {
    const user = userEvent.setup();
    renderJournal();
    await createNote(user, "Mouse");
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });
});
