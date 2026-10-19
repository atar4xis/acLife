import { describe, expect, it } from "vitest";
import {
  createJournalState,
  journalReducer,
} from "../../src/reducers/journalReducer";
import type { JournalAction, JournalItem, JournalState } from "../../src/types/Journal";
import type { SharedInfo } from "../../src/types/Share";

const info = (extra: Partial<SharedInfo> = {}): SharedInfo => ({
  space: "s1",
  owner: "o1",
  scope: "collection",
  permission: "write",
  ...extra,
});

const note = (id: string, extra: Partial<JournalItem> = {}): JournalItem => ({
  id,
  parentId: null,
  type: "note",
  name: id,
  content: "text",
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const run = (items: JournalItem[], ...actions: JournalAction[]): JournalState =>
  actions.reduce(journalReducer, { ...createJournalState(), items });

const byId = (state: JournalState, id: string) =>
  state.items.find((i) => i.id === id);

const folder = note("f", { type: "folder", _shared: info() });
const child = note("c", { parentId: "f", _shared: info() });

describe("a read-only space", () => {
  const readOnly = (extra: Partial<SharedInfo> = {}) => [
    note("f", { type: "folder", _shared: info({ permission: "read", ...extra }) }),
    note("c", { parentId: "f", _shared: info({ permission: "read", ...extra }) }),
  ];

  it("ignores every change", () => {
    const items = readOnly();
    const state = run(
      items,
      { type: "setContent", id: "c", content: "x", now: 5 },
      { type: "renameItem", id: "c", name: "x", now: 5 },
      { type: "customizeItem", id: "c", name: "x", style: {}, now: 5 },
      { type: "moveItem", id: "c", parentId: null, now: 5 },
      { type: "removeItem", id: "c" },
      { type: "removeItem", id: "f" },
      { type: "addItem", id: "n", kind: "note", name: "n", parentId: "f", style: {}, now: 5 },
    );
    expect(state.items.slice(0, 2)).toEqual(items);
    expect(byId(state, "n")).toMatchObject({ parentId: null });
    expect(byId(state, "n")?._shared).toBeUndefined();
  });
});

describe("a collection I can write", () => {
  it("edits, creates, moves and deletes inside the space", () => {
    const other = note("g", { type: "folder", _shared: info() });
    let state = run(
      [folder, child, other],
      { type: "setContent", id: "c", content: "x", now: 5 },
      { type: "renameItem", id: "c", name: "renamed", now: 6 },
    );
    expect(byId(state, "c")).toMatchObject({ content: "x", name: "renamed", updatedAt: 6 });

    state = journalReducer(state, {
      type: "addItem",
      id: "n",
      kind: "note",
      name: "n",
      parentId: "f",
      style: {},
      now: 7,
    });
    expect(byId(state, "n")).toMatchObject({ parentId: "f", _shared: info() });

    state = journalReducer(state, { type: "moveItem", id: "c", parentId: "g", now: 8 });
    expect(byId(state, "c")?.parentId).toBe("g");

    state = journalReducer(state, { type: "removeItem", id: "f" });
    expect(byId(state, "f")).toBeUndefined();
    expect(byId(state, "g")).toBeDefined();
  });

  it("does not let a shared item leave its space", () => {
    const state = run(
      [folder, child, note("own")],
      { type: "moveItem", id: "c", parentId: null, now: 5 },
      { type: "moveItem", id: "c", parentId: "own", now: 6 },
    );
    expect(byId(state, "c")?.parentId).toBe("f");
  });

  it("does not let my own item enter a shared folder", () => {
    const state = run(
      [folder, note("own")],
      { type: "moveItem", id: "own", parentId: "f", now: 5 },
    );
    expect(byId(state, "own")?.parentId).toBeNull();
  });

  it("creates new items in my own journal when the parent is not a shared folder I may write", () => {
    const state = run(
      [note("own", { type: "folder" })],
      { type: "addItem", id: "n", kind: "note", name: "n", parentId: "own", style: {}, now: 5 },
    );
    expect(byId(state, "n")?._shared).toBeUndefined();
  });

  it("falls back to the root for a missing parent", () => {
    const state = run(
      [],
      { type: "addItem", id: "n", kind: "note", name: "n", parentId: "shared:o1", style: {}, now: 5 },
    );
    expect(byId(state, "n")?.parentId).toBeNull();
  });
});

describe("a single note I can write", () => {
  const only = note("a", { _shared: info({ scope: "item" }) });

  it("edits but cannot delete, move or create", () => {
    const state = run(
      [only, note("own")],
      { type: "setContent", id: "a", content: "x", now: 5 },
      { type: "removeItem", id: "a" },
      { type: "moveItem", id: "a", parentId: "own", now: 6 },
      { type: "addItem", id: "n", kind: "note", name: "n", parentId: "a", style: {}, now: 7 },
    );
    expect(byId(state, "a")).toMatchObject({ content: "x" });
    expect(byId(state, "n")?._shared).toBeUndefined();
  });
});

describe("a folder with something I may not delete", () => {
  it("keeps the whole folder when a descendant is protected", () => {
    const state = run(
      [
        note("own-f", { type: "folder" }),
        note("x", { parentId: "own-f", _shared: info({ permission: "read" }) }),
      ],
      { type: "removeItem", id: "own-f" },
    );
    expect(state.items).toHaveLength(2);
  });
});

describe("setSharedSpaces", () => {
  it("removes the items of spaces that are gone and closes their tabs", () => {
    const state = run(
      [note("own"), folder, child],
      { type: "openNote", id: "c", newTab: false },
      { type: "setSharedSpaces", spaces: [] },
    );
    expect(state.items.map((i) => i.id)).toEqual(["own"]);
    expect(JSON.stringify(state.workspace)).not.toContain('"c"');
  });

  it("updates the permission of a space that is still there", () => {
    const state = run(
      [folder, child],
      { type: "setSharedSpaces", spaces: [info({ permission: "read" })] },
    );
    expect(state.items.every((i) => i._shared?.permission === "read")).toBe(true);
  });

  it("keeps the same state object when nothing changed", () => {
    const start = { ...createJournalState(), items: [note("own"), folder] };
    expect(
      journalReducer(start, { type: "setSharedSpaces", spaces: [info()] }),
    ).toBe(start);
  });
});

describe("setAllExpanded", () => {
  it("also opens the virtual folders of the owners", () => {
    const state = run(
      [child],
      { type: "setAllExpanded", expanded: true },
    );
    expect(state.expanded.has("shared:o1")).toBe(true);
  });
});
