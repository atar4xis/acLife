import { act, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoViolations } from "../a11y/axe.ts";
import {
  createNote,
  dragAt,
  dragStart,
  editorView,
  journalUi,
  key,
  renderJournal,
  resetJournal,
  setSession,
  store,
  tabList,
  treeItem,
} from "./helpers.tsx";
import { encryptJson } from "../../src/lib/crypt.ts";
import { decryptJournal } from "../../src/lib/journal/crypt.ts";
import {
  JournalProvider,
  useJournal,
} from "../../src/context/JournalContext.tsx";

afterEach(resetJournal);

describe("journal persistence", () => {
  it("creates notes, renames through the title and persists encrypted", async () => {
    const user = userEvent.setup();
    const { container } = renderJournal();

    await createNote(user, "First");
    await createNote(user, "Second");
    expect(screen.getByLabelText("Close First")).toBeTruthy();

    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Renamed");
    expect(screen.getByLabelText("Close Renamed")).toBeTruthy();
    expect(treeItem("Renamed")).toBeTruthy();

    act(() => {
      const view = editorView();
      view.dispatch({ changes: { from: 0, insert: "secret words" } });
    });
    await expectNoViolations(container);

    await waitFor(() =>
      expect(store.get("journal")).toBeInstanceOf(ArrayBuffer),
    );
    expect(
      new TextDecoder().decode(store.get("journal") as ArrayBuffer),
    ).not.toContain("secret");
  });
  it("saves pending edits when the journal unmounts before the debounce", async () => {
    const user = userEvent.setup();
    const { unmount } = renderJournal();
    await createNote(user, "Note");

    act(() => {
      editorView().dispatch({ changes: { from: 0, insert: "late words" } });
    });
    unmount();

    await waitFor(async () => {
      const saved = await decryptJournal(store.get("journal") as never, key);
      expect(saved.items[0].content).toBe("late words");
    });
  });
  it("restores the whole layout after a restart", async () => {
    const user = userEvent.setup();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 100),
    );
    const first = renderJournal();

    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.keyboard("Docs{Enter}");
    await createNote(user, "Left");
    await createNote(user, "Right");
    await createNote(user, "Third");
    await user.click(screen.getByRole("button", { name: "New tab" }));
    await dragStart(within(tabList()).getByText("Right").closest("li")!);
    dragAt("dragOver", screen.getByTestId("drop-overlay"), 95, 50);
    dragAt("drop", screen.getByTestId("drop-overlay"), 95, 50);
    await waitFor(() =>
      expect(
        screen.getAllByRole("tablist", { name: "Open notes" }),
      ).toHaveLength(2),
    );
    await user.click(screen.getByRole("button", { name: "Reading mode" }));
    await user.click(treeItem("Docs"));

    await waitFor(() => {
      expect(store.get("journal")).toBeInstanceOf(ArrayBuffer);
      expect(store.get("journalLayout")).toBeInstanceOf(ArrayBuffer);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    first.unmount();

    renderJournal();
    await waitFor(() =>
      expect(
        screen.getAllByRole("tablist", { name: "Open notes" }),
      ).toHaveLength(2),
    );
    const [leftTabs, rightTabs] = screen.getAllByRole("tablist", {
      name: "Open notes",
    });
    const names = (list: HTMLElement) =>
      within(list)
        .getAllByRole("tab")
        .map((tab) => tab.textContent);
    expect(names(leftTabs)).toEqual(["Left", "Third", "New tab"]);
    expect(names(rightTabs)).toEqual(["Right"]);
    expect(screen.queryByRole("button", { name: "Reading mode" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit mode" })).toBeTruthy();
    expect(treeItem("Docs").getAttribute("aria-expanded")).toBe("true");
  });
  it("restores split sizes", async () => {
    let seen: Record<string, number[]> = {};
    const Probe = () => {
      const journal = useJournal();
      seen = journal.splitSizes;
      return (
        <button onClick={() => journal.setSplitSizes("a,b", [30, 70])}>
          resize
        </button>
      );
    };
    const mount = () =>
      render(
        <JournalProvider>
          <Probe />
        </JournalProvider>,
      );
    const user = userEvent.setup();

    const first = mount();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    await user.click(screen.getByText("resize"));
    await waitFor(() =>
      expect(store.get("journalLayout")).toBeInstanceOf(ArrayBuffer),
    );
    first.unmount();

    mount();
    await waitFor(() => expect(seen).toEqual({ "a,b": [30, 70] }));
  });

  const storeNote = async (slot = "journal") =>
    store.set(
      slot,
      await encryptJson(
        {
          sort: "name-asc",
          items: [
            {
              id: "n1",
              parentId: null,
              type: "note",
              name: "Stored",
              content: "",
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
        key,
      ),
    );

  it("loads the stored journal", async () => {
    await storeNote();
    renderJournal();

    expect(
      await screen.findByRole("treeitem", { name: "Stored" }),
    ).toBeTruthy();
  });

  it("waits for the storage before loading", async () => {
    await storeNote();
    setSession({ ready: false });
    const view = renderJournal();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryByRole("treeitem", { name: "Stored" })).toBeNull();

    setSession({ ready: true });
    view.rerender(journalUi());
    expect(
      await screen.findByRole("treeitem", { name: "Stored" }),
    ).toBeTruthy();
  });

  it("empties the journal when the account locks", async () => {
    await storeNote();
    const view = renderJournal();
    await screen.findByRole("treeitem", { name: "Stored" });

    setSession({ masterKey: null });
    view.rerender(journalUi());

    await waitFor(() =>
      expect(screen.queryByRole("treeitem", { name: "Stored" })).toBeNull(),
    );
    expect(screen.getByText("No notes yet.")).toBeTruthy();
  });

  it("ignores a load that finishes after the account locked", async () => {
    await storeNote();
    const view = renderJournal();
    setSession({ masterKey: null });
    view.rerender(journalUi());

    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(screen.queryByRole("treeitem", { name: "Stored" })).toBeNull();
  });

  it("toasts and never overwrites a journal that cannot be decrypted", async () => {
    const broken = new Uint8Array(64).buffer;
    setSession({ user: { type: "offline" } });
    store.set("offlineJournal", broken);
    renderJournal();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not decrypt the journal.",
      ),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));

    expect(store.get("offlineJournal")).toBe(broken);
  });
  it("shows the load error instead of an editable journal", async () => {
    setSession({ user: { type: "offline" } });
    store.set("offlineJournal", new Uint8Array(64).buffer);
    renderJournal();

    expect(await screen.findByText("Could not decrypt the journal.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New note" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
  it("does not toast a failed load after the account locked", async () => {
    setSession({ user: { type: "offline" } });
    store.set("offlineJournal", new Uint8Array(64).buffer);
    const view = renderJournal();
    setSession({ masterKey: null });
    view.rerender(journalUi());

    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not save the emptied journal over an unreadable one after unlocking again", async () => {
    setSession({ user: { type: "offline" } });
    await storeNote("offlineJournal");
    const view = renderJournal();
    await screen.findByRole("treeitem", { name: "Stored" });
    setSession({ masterKey: null });
    view.rerender(journalUi());
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    const broken = new Uint8Array(64).buffer;
    store.set("offlineJournal", broken);

    setSession({ masterKey: key });
    view.rerender(journalUi());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));

    expect(store.get("offlineJournal")).toBe(broken);
  });
  describe("storage slots", () => {
    const otherKey = () =>
      crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);

    it("offline mode reads and writes only offlineJournal", async () => {
      setSession({ user: { type: "offline" } });
      await storeNote("offlineJournal");
      const cache = new Uint8Array(8).buffer;
      store.set("journal", cache);
      const user = userEvent.setup();
      renderJournal();

      await screen.findByRole("treeitem", { name: "Stored" });
      await createNote(user, "Fresh");
      await waitFor(async () => {
        const saved = await decryptJournal(
          store.get("offlineJournal") as never,
          key,
        );
        expect(saved.items.map((item) => item.name)).toContain("Fresh");
      });
      expect(store.get("journal")).toBe(cache);
    });

    it("an online user reads and writes the journal cache", async () => {
      setSession({ user: { type: "online" } });
      const offline = new Uint8Array(8).buffer;
      store.set("offlineJournal", offline);
      await storeNote();
      const user = userEvent.setup();
      renderJournal();

      await screen.findByRole("treeitem", { name: "Stored" });
      await createNote(user, "Fresh");
      await waitFor(async () => {
        const saved = await decryptJournal(store.get("journal") as never, key);
        expect(saved.items.map((item) => item.name)).toContain("Fresh");
      });
      expect(store.get("offlineJournal")).toBe(offline);
    });

    it("discards an online cache of another account and starts empty", async () => {
      setSession({ user: { type: "online" } });
      store.set(
        "journal",
        await encryptJson(
          { sort: "name-asc", items: [] },
          await otherKey(),
        ),
      );
      renderJournal();

      await waitFor(() =>
        expect(toast.warning).toHaveBeenCalledWith(
          "Failed to decrypt the journal cache; it will be discarded.",
        ),
      );
      expect(toast.error).not.toHaveBeenCalled();
      expect(await screen.findByText("No notes yet.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "New note" })).toBeTruthy();
      await waitFor(async () => {
        await decryptJournal(store.get("journal") as never, key);
      });
    });

    it("moves a legacy offline blob from journal to offlineJournal", async () => {
      setSession({ user: { type: "offline" } });
      await storeNote();
      const legacy = store.get("journal");
      renderJournal();

      expect(
        await screen.findByRole("treeitem", { name: "Stored" }),
      ).toBeTruthy();
      expect(store.get("offlineJournal")).toBe(legacy);
      expect(store.get("journal")).toBeNull();
    });

    it("leaves a legacy blob it cannot decrypt alone in offline mode", async () => {
      setSession({ user: { type: "offline" } });
      const foreign = await encryptJson(
        { sort: "name-asc", items: [] },
        await otherKey(),
      );
      store.set("journal", foreign);
      renderJournal();

      expect(await screen.findByText("No notes yet.")).toBeTruthy();
      expect(toast.error).not.toHaveBeenCalled();
      expect(store.get("journal")).toBe(foreign);
    });
  });
});
