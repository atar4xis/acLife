import { describe, expect, it } from "vitest";
import { isNewTab, panesOf } from "../../src/lib/journal/layout.ts";
import {
  createJournalState,
  journalReducer,
} from "../../src/reducers/journalReducer.ts";
import type {
  JournalAction,
  JournalItem,
  JournalState,
} from "../../src/types/Journal.ts";

const run = (...actions: JournalAction[]) =>
  actions.reduce(journalReducer, createJournalState());

const add = (
  id: string,
  kind: "note" | "folder" = "note",
  parentId: string | null = null,
  now = 1,
): JournalAction => ({
  type: "addItem",
  id,
  kind,
  name: id,
  parentId,
  style: {},
  now,
});

const open = (id: string, newTab = false): JournalAction => ({
  type: "openNote",
  id,
  newTab,
});

const panes = (state: JournalState) => panesOf(state.workspace.layout);
const item = (state: JournalState, id: string) =>
  state.items.find((i) => i.id === id)!;

describe("journalReducer", () => {
  it("hydrate replaces only the given slices", () => {
    const base = run(add("a"), { type: "setSort", sort: "created-asc" });
    const state = journalReducer(base, {
      type: "hydrate",
      state: { items: [], splitSizes: { k: [30, 70] } },
    });

    expect(state.items).toEqual([]);
    expect(state.splitSizes).toEqual({ k: [30, 70] });
    expect(state.sort).toBe("created-asc");
    expect(state.workspace).toBe(base.workspace);
  });

  it("addItem appends an empty item with the given id, name and time", () => {
    const state = run(add("n", "note", null, 5));

    expect(state.items).toEqual([
      {
        id: "n",
        parentId: null,
        type: "note",
        name: "n",
        content: "",
        createdAt: 5,
        updatedAt: 5,
      },
    ]);
    expect(state.expanded.size).toBe(0);
  });

  it("addItem puts an item with an unknown parent at the root", () => {
    const state = journalReducer(createJournalState(), add("n", "note", "gone"));

    expect(state.items[0].parentId).toBeNull();
  });

  it("addItem keeps the appearance it is given", () => {
    const state = journalReducer(createJournalState(), {
      type: "addItem",
      id: "n",
      kind: "note",
      name: "n",
      parentId: null,
      style: { icon: "star", color: "#111111" },
      now: 1,
    });

    expect(state.items[0]).toMatchObject({ icon: "star", color: "#111111" });
  });

  it("customizeItem renames and replaces the appearance, clearing what is absent", () => {
    const base = journalReducer(createJournalState(), {
      type: "addItem",
      id: "n",
      kind: "note",
      name: "n",
      parentId: null,
      style: { icon: "star", color: "#111111" },
      now: 1,
    });
    const state = journalReducer(base, {
      type: "customizeItem",
      id: "n",
      name: "Renamed",
      style: { background: "#222222" },
      now: 5,
    });

    expect(state.items[0]).toMatchObject({
      name: "Renamed",
      background: "#222222",
      updatedAt: 5,
    });
    expect(state.items[0].icon).toBeUndefined();
    expect(state.items[0].color).toBeUndefined();
  });

  it("addItem expands the parent folder", () => {
    const state = run(add("f", "folder"), add("n", "note", "f"));

    expect(item(state, "n").parentId).toBe("f");
    expect(Array.from(state.expanded)).toEqual(["f"]);
  });

  it("renameItem sets the name and modified time of that item only", () => {
    const state = run(add("a"), add("b"), {
      type: "renameItem",
      id: "a",
      name: "New",
      now: 9,
    });

    expect(item(state, "a")).toMatchObject({
      name: "New",
      updatedAt: 9,
      createdAt: 1,
    });
    expect(item(state, "b")).toMatchObject({ name: "b", updatedAt: 1 });
  });

  it("setContent sets the content and modified time of that item only", () => {
    const state = run(add("a"), add("b"), {
      type: "setContent",
      id: "a",
      content: "text",
      now: 9,
    });

    expect(item(state, "a")).toMatchObject({ content: "text", updatedAt: 9 });
    expect(item(state, "b")).toMatchObject({ content: "", updatedAt: 1 });
  });

  it("moveItem changes the parent, bumps the modified time and expands the parent", () => {
    const state = run(add("f", "folder"), add("n"), {
      type: "moveItem",
      id: "n",
      parentId: "f",
      now: 9,
    });

    expect(item(state, "n")).toMatchObject({ parentId: "f", updatedAt: 9 });
    expect(Array.from(state.expanded)).toEqual(["f"]);
  });

  it("moveItem to the root keeps the expanded set", () => {
    const before = run(add("f", "folder"), add("n", "note", "f"));
    const state = journalReducer(before, {
      type: "moveItem",
      id: "n",
      parentId: null,
      now: 9,
    });

    expect(item(state, "n").parentId).toBeNull();
    expect(state.expanded).toBe(before.expanded);
  });

  it("removeItem deletes the subtree and closes its open notes", () => {
    const state = run(
      add("f", "folder"),
      add("child", "note", "f"),
      add("other"),
      open("child", true),
      open("other", true),
      { type: "removeItem", id: "f" },
    );

    expect(state.items.map((i) => i.id)).toEqual(["other"]);
    expect(panes(state).flatMap((pane) => pane.tabs)).toEqual(["other"]);
  });

  it("removeItem forgets the expanded state of removed folders", () => {
    const state = run(
      add("f", "folder"),
      add("g", "folder"),
      add("child", "note", "f"),
      { type: "toggleFolder", id: "g" },
      { type: "removeItem", id: "f" },
    );

    expect(Array.from(state.expanded)).toEqual(["g"]);
  });

  it("setSort sets the sort order", () => {
    expect(run({ type: "setSort", sort: "modified-asc" }).sort).toBe(
      "modified-asc",
    );
  });

  it("toggleFolder expands and collapses", () => {
    const toggle: JournalAction = { type: "toggleFolder", id: "f" };
    const expanded = run(toggle);

    expect(Array.from(expanded.expanded)).toEqual(["f"]);
    expect(journalReducer(expanded, toggle).expanded.size).toBe(0);
  });

  it("setAllExpanded expands every folder but no notes, or collapses all", () => {
    const filled = run(
      add("f1", "folder"),
      add("f2", "folder", "f1"),
      add("n", "note", "f2"),
    );
    const all = journalReducer(filled, {
      type: "setAllExpanded",
      expanded: true,
    });

    expect(Array.from(all.expanded).toSorted()).toEqual(["f1", "f2"]);
    expect(
      journalReducer(all, { type: "setAllExpanded", expanded: false }).expanded
        .size,
    ).toBe(0);
  });

  it("setSplitSizes stores sizes per key", () => {
    const state = run(
      { type: "setSplitSizes", key: "a", sizes: [40, 60] },
      { type: "setSplitSizes", key: "b", sizes: [10, 90] },
      { type: "setSplitSizes", key: "a", sizes: [50, 50] },
    );

    expect(state.splitSizes).toEqual({ a: [50, 50], b: [10, 90] });
  });

  it("setReading toggles reading mode of one pane", () => {
    const base = run(add("n"), open("n"));
    const paneId = panes(base)[0].id;

    const reading = journalReducer(base, {
      type: "setReading",
      paneId,
      reading: true,
    });
    expect(panes(reading)[0].reading).toBe(true);
    expect(
      panes(
        journalReducer(reading, { type: "setReading", paneId, reading: false }),
      )[0].reading,
    ).toBe(false);
  });

  it("addTab adds an empty tab and activates it", () => {
    const base = run(add("n"), open("n"));
    const state = journalReducer(base, {
      type: "addTab",
      paneId: panes(base)[0].id,
    });

    const [pane] = panes(state);
    expect(pane.tabs).toHaveLength(2);
    expect(isNewTab(pane.active!)).toBe(true);
  });

  it("openNote replaces the active tab, or adds a tab when asked", () => {
    const replaced = run(add("a"), add("b"), open("a"), open("b"));
    expect(panes(replaced)[0].tabs).toEqual(["b"]);

    const added = run(add("a"), add("b"), open("a"), open("b", true));
    expect(panes(added)[0]).toMatchObject({ tabs: ["a", "b"], active: "b" });
  });

  it("activateTab activates the tab and focuses its pane", () => {
    const base = run(add("a"), add("b"), open("a"), open("b", true));
    const paneId = panes(base)[0].id;
    const state = journalReducer(base, {
      type: "activateTab",
      paneId,
      id: "a",
    });

    expect(panes(state)[0].active).toBe("a");
    expect(state.workspace.focused).toBe(paneId);
  });

  it("closeTab removes the tab and activates its neighbor", () => {
    const base = run(add("a"), add("b"), open("a"), open("b", true));
    const state = journalReducer(base, {
      type: "closeTab",
      paneId: panes(base)[0].id,
      id: "b",
    });

    expect(panes(state)[0]).toMatchObject({ tabs: ["a"], active: "a" });
  });

  it("focusPane focuses a pane and keeps the same state when already focused", () => {
    const joined = run(add("a"), add("b"), open("a"), open("b", true));
    const first = panes(joined)[0].id;
    const split = journalReducer(joined, {
      type: "dropOnPane",
      drag: { id: "b", fromPane: first },
      paneId: first,
      zone: "right",
    });
    expect(split.workspace.focused).not.toBe(first);

    const state = journalReducer(split, { type: "focusPane", paneId: first });
    expect(state.workspace.focused).toBe(first);
    expect(journalReducer(state, { type: "focusPane", paneId: first })).toBe(
      state,
    );
  });

  it("dropOnPane on an edge splits the layout and moves the tab", () => {
    const base = run(add("a"), add("b"), open("a"), open("b", true));
    const paneId = panes(base)[0].id;
    const state = journalReducer(base, {
      type: "dropOnPane",
      drag: { id: "b", fromPane: paneId },
      paneId,
      zone: "right",
    });

    expect(state.workspace.layout.kind).toBe("split");
    expect(panes(state).map((pane) => pane.tabs)).toEqual([["a"], ["b"]]);
    expect(state.workspace.focused).toBe(panes(state)[1].id);
  });

  it("dropOnTabs reorders tabs within a pane", () => {
    const base = run(
      add("a"),
      add("b"),
      add("c"),
      open("a"),
      open("b", true),
      open("c", true),
    );
    const paneId = panes(base)[0].id;
    const state = journalReducer(base, {
      type: "dropOnTabs",
      drag: { id: "c", fromPane: paneId },
      paneId,
      index: 1,
    });

    expect(panes(state)[0].tabs).toEqual(["a", "c", "b"]);
  });
});

describe("applyRemote", () => {
  const remote = (id: string, updatedAt: number, name = id): JournalItem => ({
    id,
    parentId: null,
    type: "note",
    name,
    content: "",
    createdAt: 1,
    updatedAt,
  });

  it("replaces known items, appends unknown ones and keeps object identity", () => {
    const before = run(add("a"), add("b"));
    const changed = remote("a", 5, "renamed");
    const created = remote("c", 6);
    const state = journalReducer(before, {
      type: "applyRemote",
      upserts: [changed, created],
      deletedIds: [],
    });

    expect(state.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(state.items[0]).toBe(changed);
    expect(state.items[1]).toBe(before.items[1]);
    expect(state.items[2]).toBe(created);
  });

  it("removes deleted items, their expanded state and open tabs", () => {
    const before = run(
      add("f", "folder"),
      add("n", "note", "f"),
      add("keep"),
      open("n", true),
      open("keep", true),
    );
    const state = journalReducer(before, {
      type: "applyRemote",
      upserts: [],
      deletedIds: ["f", "n"],
    });

    expect(state.items.map((i) => i.id)).toEqual(["keep"]);
    expect(Array.from(state.expanded)).toEqual([]);
    expect(panes(state).flatMap((pane) => pane.tabs)).toEqual(["keep"]);
  });

  it("keeps a local item that is newer than the incoming one", () => {
    const before = journalReducer(run(add("a")), {
      type: "setContent",
      id: "a",
      content: "typed",
      now: 10,
    });
    const state = journalReducer(before, {
      type: "applyRemote",
      upserts: [remote("a", 5, "stale")],
      deletedIds: [],
    });

    expect(state.items[0]).toBe(before.items[0]);
  });

  it("leaves the layout alone when nothing is deleted", () => {
    const before = run(add("a"), open("a", true));
    const state = journalReducer(before, {
      type: "applyRemote",
      upserts: [remote("a", 9)],
      deletedIds: [],
    });

    expect(state.workspace).toBe(before.workspace);
    expect(state.expanded).toBe(before.expanded);
  });
});

describe("importItems", () => {
  const imported = (
    id: string,
    updatedAt: number,
    content: string,
  ): JournalItem => ({
    id,
    parentId: null,
    type: "note",
    name: "imported",
    content,
    createdAt: 1,
    updatedAt,
  });

  it("appends new items and keeps untouched ones", () => {
    const before = run(add("a"));
    const created = imported("b", 5, "new");
    const state = journalReducer(before, {
      type: "importItems",
      upserts: [created],
    });

    expect(state.items[0]).toBe(before.items[0]);
    expect(state.items[1]).toBe(created);
  });

  it("replaces only the content of a known item", () => {
    const before = run(add("f", "folder"), add("a", "note", "f", 1));
    const state = journalReducer(before, {
      type: "importItems",
      upserts: [imported("a", 9, "replaced")],
    });

    expect(item(state, "a")).toMatchObject({
      name: "a",
      parentId: "f",
      content: "replaced",
      updatedAt: 9,
    });
  });

  it("moves new items whose parent no longer exists to the root", () => {
    const before = run(add("a"));
    const orphan = { ...imported("b", 5, "x"), parentId: "gone" };
    const child = { ...imported("c", 5, "x"), parentId: "b" };
    const state = journalReducer(before, {
      type: "importItems",
      upserts: [orphan, child],
    });

    expect(state.items.map((i) => [i.id, i.parentId])).toEqual([
      ["a", null],
      ["b", null],
      ["c", "b"],
    ]);
  });

  it("keeps new items whose parent comes in the same batch", () => {
    const folder = { ...imported("f", 5, ""), type: "folder" as const };
    const note = { ...imported("n", 5, "x"), parentId: "f" };
    const state = journalReducer(run(add("a")), {
      type: "importItems",
      upserts: [folder, note],
    });

    expect(state.items.map((i) => i.id)).toEqual(["a", "f", "n"]);
  });

  it("never lowers the updatedAt of a known item", () => {
    const before = run(add("a", "note", null, 10));
    const state = journalReducer(before, {
      type: "importItems",
      upserts: [imported("a", 5, "replaced")],
    });

    expect(item(state, "a")).toMatchObject({ content: "replaced", updatedAt: 11 });
  });
});
