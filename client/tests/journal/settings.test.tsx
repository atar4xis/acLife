import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  editorView,
  journal,
  renderLoadedJournal,
  resetJournal,
  treeItem,
} from "./helpers.tsx";
import { render } from "@testing-library/react";
import JournalPage from "../../src/components/settings/pages/JournalPage.tsx";
import { JournalProvider } from "../../src/context/JournalContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import { readSettings, seedSettings } from "../settingsStorage.ts";

beforeEach(() => localStorage.clear());
afterEach(resetJournal);

const addNote = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "New note" }));
};

describe("journal settings", () => {
  it("shows the title and status bar by default, without line numbers", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    await addNote(user);

    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByText("Words: 0")).toBeInTheDocument();
    expect(screen.getByText("Line: 1")).toBeInTheDocument();
    expect(screen.getByText("Column: 1")).toBeInTheDocument();
    expect(document.querySelector(".cm-lineNumbers")).toBeNull();

    act(() => {
      editorView().dispatch({
        changes: { from: 0, insert: "ab\ncde fg" },
        selection: { anchor: 8 },
      });
    });
    expect(screen.getByText("Line: 2")).toBeInTheDocument();
    expect(screen.getByText("Column: 6")).toBeInTheDocument();
    expect(screen.getByText("Words: 3")).toBeInTheDocument();
    expect(screen.getByText("Characters: 9")).toBeInTheDocument();
  });

  it("hides the title and status bar and turns on line numbers", async () => {
    seedSettings({
      journalShowTitle: false,
      journalStatusBar: false,
      journalLineNumbers: true,
    });
    const user = userEvent.setup();
    await renderLoadedJournal();
    await addNote(user);

    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(screen.queryByText("Words: 0")).toBeNull();
    expect(document.querySelector(".cm-lineNumbers")).not.toBeNull();
  });

  it("stamps the note defaults on new items", async () => {
    seedSettings({
      journalNoteName: "Log {YYYY}",
      journalNoteIcon: "Star",
      journalForegroundEnabled: true,
      journalForeground: "#112233",
      journalBackgroundEnabled: true,
      journalBackground: "#445566",
      journalColorIcons: false,
    });
    const user = userEvent.setup();
    await renderLoadedJournal();
    await addNote(user);

    const note = journal.items.find((item) => item.type === "note")!;
    expect(note.name).toBe(`Log ${new Date().getFullYear()}`);
    expect(note).toMatchObject({
      icon: "Star",
      color: "#112233",
      background: "#445566",
      colorIcon: false,
    });
    expect(treeItem(note.name)).toBeInTheDocument();
  });

  it("edits the settings from the journal page and hides the location without folders", async () => {
    const user = userEvent.setup();
    render(
      <SettingsStoreProvider>
        <JournalProvider>
          <JournalPage sectionRefs={{ current: new Map() }} />
        </JournalProvider>
      </SettingsStoreProvider>,
    );

    expect(screen.queryByText("Location")).toBeNull();

    await user.click(screen.getByRole("switch", { name: "Show line numbers" }));
    await user.click(
      screen.getByRole("switch", { name: "Foreground color" }),
    );
    await user.click(screen.getByRole("button", { name: "Note icon" }));
    await user.type(screen.getByLabelText("Search icons..."), "star");
    await user.click(screen.getByRole("button", { name: "Star" }));

    expect(readSettings()).toMatchObject({
      journalLineNumbers: true,
      journalForegroundEnabled: true,
      journalNoteIcon: "Star",
    });
  });

  it("customizes an item from its context menu", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    await addNote(user);
    const note = journal.items.find((item) => item.type === "note")!;

    await user.pointer({
      keys: "[MouseRight]",
      target: treeItem(note.name),
    });
    await user.click(await screen.findByRole("menuitem", { name: "Customize" }));
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Styled");
    await user.click(screen.getByRole("switch", { name: "Background color" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(journal.itemsById.get(note.id)).toMatchObject({
      name: "Styled",
      background: "#e5e5e5",
    });
    expect(journal.itemsById.get(note.id)!.color).toBeUndefined();
  });

  it("resets a customized value to the default from the dialog", async () => {
    const user = userEvent.setup();
    await renderLoadedJournal();
    await addNote(user);
    const note = journal.items.find((item) => item.type === "note")!;

    await user.pointer({
      keys: "[MouseRight]",
      target: treeItem(note.name),
    });
    await user.click(await screen.findByRole("menuitem", { name: "Customize" }));
    const name = await screen.findByLabelText("Name");
    expect(screen.queryByRole("button", { name: "Reset to default" })).toBeNull();

    await user.type(name, "x");
    expect(screen.queryByRole("button", { name: "Reset to default" })).toBeNull();

    await user.click(screen.getByRole("switch", { name: "Background color" }));
    await user.click(screen.getByRole("button", { name: "Reset to default" }));

    expect(screen.queryByRole("button", { name: "Reset to default" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Background color" })).toBeNull();
  });

  describe("color presets", () => {
    const openCustomize = async (user: ReturnType<typeof userEvent.setup>) => {
      await renderLoadedJournal();
      await addNote(user);
      const note = journal.items.find((item) => item.type === "note")!;

      await user.pointer({
        keys: "[MouseRight]",
        target: treeItem(note.name),
      });
      await user.click(
        await screen.findByRole("menuitem", { name: "Customize" }),
      );
      await user.click(
        await screen.findByRole("switch", { name: "Foreground color" }),
      );
      return note;
    };

    const typeColor = async (
      user: ReturnType<typeof userEvent.setup>,
      hex: string,
    ) => {
      await user.click(screen.getByRole("button", { name: "Foreground color" }));
      const input = screen.getByLabelText("Hex color");
      await user.clear(input);
      await user.type(input, hex);
      await user.keyboard("{Escape}");
    };

    it("offers the presets in the customize dialog", async () => {
      seedSettings({ journalColorPresets: ["#123456", "#654321"] });
      const user = userEvent.setup();
      const note = await openCustomize(user);

      await user.click(screen.getByRole("button", { name: "Foreground color" }));
      expect(screen.queryByRole("button", { name: "#2563eb" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "#654321" }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(journal.itemsById.get(note.id)!.color).toBe("#654321");
    });

    it("adds a new color to the presets when customizing", async () => {
      seedSettings({ journalAddColorsAutomatically: true });
      const user = userEvent.setup();
      await openCustomize(user);

      await typeColor(user, "abcdef");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(readSettings().journalColorPresets).toContain("#abcdef");
    });

    it("leaves the presets alone unless adding automatically", async () => {
      seedSettings({});
      const user = userEvent.setup();
      await openCustomize(user);

      await typeColor(user, "abcdef");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(readSettings().journalColorPresets).toBeUndefined();
    });

    it("offers the presets in the settings page color pickers", async () => {
      seedSettings({
        journalColorPresets: ["#123456"],
        journalForegroundEnabled: true,
      });
      const user = userEvent.setup();
      render(
        <SettingsStoreProvider>
          <JournalProvider>
            <JournalPage sectionRefs={{ current: new Map() }} />
          </JournalProvider>
        </SettingsStoreProvider>,
      );

      await user.click(screen.getByRole("button", { name: "Foreground color" }));
      await user.click(screen.getByRole("button", { name: "#123456" }));

      await waitFor(() =>
        expect(readSettings().journalForeground).toBe("#123456"),
      );
    });

    it("manages the presets from the settings page", async () => {
      const user = userEvent.setup();
      render(
        <SettingsStoreProvider>
          <JournalProvider>
            <JournalPage sectionRefs={{ current: new Map() }} />
          </JournalProvider>
        </SettingsStoreProvider>,
      );

      await user.click(screen.getByRole("button", { name: "New color" }));
      const input = screen.getByLabelText("Hex color");
      await user.clear(input);
      await user.type(input, "abcdef");
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "Add color" }));
      await user.click(
        screen.getByRole("switch", { name: "Add new colors automatically" }),
      );

      expect(readSettings()).toMatchObject({
        journalColorPresets: expect.arrayContaining(["#abcdef"]),
        journalAddColorsAutomatically: true,
      });
    });
  });
});
