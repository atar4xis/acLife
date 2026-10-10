import { describe, expect, it } from "vitest";
import {
  buildTree,
  canMoveItem,
  descendantIds,
  filterTree,
  moveTargets,
  toOutline,
  visibleRows,
} from "../../src/lib/journal/item.ts";
import type { JournalItem } from "../../src/types/Journal.ts";

const item = (
  id: string,
  type: JournalItem["type"],
  parentId: string | null,
  extra: Partial<JournalItem> = {},
): JournalItem => ({
  id,
  type,
  parentId,
  name: id,
  content: "",
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

const items = [
  item("b-note", "note", null),
  item("a-note", "note", null),
  item("z-folder", "folder", null),
  item("inner", "note", "z-folder", { content: "Secret text" }),
];

const ids = (nodes: ReturnType<typeof buildTree>) =>
  nodes.map((node) => node.item.id);

describe("journal tree", () => {
  it("nests children and lists folders before notes", () => {
    const tree = buildTree(items, "name-asc");
    expect(ids(tree)).toEqual(["z-folder", "a-note", "b-note"]);
    expect(ids(tree[0].children)).toEqual(["inner"]);
  });

  it("sorts by name descending, numerically", () => {
    const tree = buildTree(
      [item("n2", "note", null), item("n10", "note", null)],
      "name-desc",
    );
    expect(ids(tree)).toEqual(["n10", "n2"]);
  });

  it("sorts by modified and created time", () => {
    const dated = [
      item("old", "note", null, { updatedAt: 1, createdAt: 9 }),
      item("new", "note", null, { updatedAt: 2, createdAt: 8 }),
    ];
    expect(ids(buildTree(dated, "modified-desc"))).toEqual(["new", "old"]);
    expect(ids(buildTree(dated, "modified-asc"))).toEqual(["old", "new"]);
    expect(ids(buildTree(dated, "created-desc"))).toEqual(["old", "new"]);
    expect(ids(buildTree(dated, "created-asc"))).toEqual(["new", "old"]);
  });

  it("filters by name or content and keeps matching ancestors", () => {
    const tree = buildTree(items, "name-asc");
    expect(ids(filterTree(tree, "A-NOTE"))).toEqual(["a-note"]);

    const byContent = filterTree(tree, "secret");
    expect(ids(byContent)).toEqual(["z-folder"]);
    expect(ids(byContent[0].children)).toEqual(["inner"]);
    expect(filterTree(tree, "nothing")).toEqual([]);
  });

  it("collects a folder with all descendants", () => {
    expect(descendantIds(items, "z-folder").toSorted()).toEqual([
      "inner",
      "z-folder",
    ]);
  });

  it("shows folders of a parent cycle at the root and terminates", () => {
    const cycle = [
      item("f", "folder", "g"),
      item("g", "folder", "f"),
      item("n", "note", "f"),
    ];

    const tree = buildTree(cycle, "name-asc");
    expect(ids(tree)).toEqual(["f", "g"]);
    expect(ids(tree[0].children)).toEqual(["n"]);
    expect(descendantIds(cycle, "f").toSorted()).toEqual(["f", "g", "n"]);
  });
});

describe("moving items", () => {
  const nested = [
    item("root-note", "note", null),
    item("docs", "folder", null),
    item("sub", "folder", "docs"),
    item("deep", "folder", "sub"),
    item("in-docs", "note", "docs"),
    item("other", "folder", null),
  ];
  const find = (id: string) => nested.find((i) => i.id === id)!;

  it("only allows a new parent that is not the current one or inside the item", () => {
    expect(canMoveItem(nested, find("sub"), null)).toBe(true);
    expect(canMoveItem(nested, find("sub"), "other")).toBe(true);
    expect(canMoveItem(nested, find("sub"), "docs")).toBe(false);
    expect(canMoveItem(nested, find("sub"), "sub")).toBe(false);
    expect(canMoveItem(nested, find("docs"), "deep")).toBe(false);
    expect(canMoveItem(nested, find("root-note"), null)).toBe(false);
  });

  it("lists the root and every folder in tree order with their depth", () => {
    const targets = moveTargets(nested, "name-asc", find("root-note")).map(
      ({ folder, depth }) => [folder?.id ?? null, depth],
    );
    expect(targets).toEqual([
      ["docs", 1],
      ["sub", 2],
      ["deep", 3],
      ["other", 1],
    ]);
  });

  it("leaves out the current parent and the item's own subtree", () => {
    const targets = moveTargets(nested, "name-asc", find("sub")).map(
      ({ folder }) => folder?.id ?? null,
    );
    expect(targets).toEqual([null, "other"]);
  });

  it("has no target for an item that cannot go anywhere", () => {
    expect(
      moveTargets(
        [item("only", "note", null)],
        "name-asc",
        item("only", "note", null),
      ),
    ).toEqual([]);
  });
});

describe("visible rows", () => {
  const tree = buildTree(items, "name-asc");

  it("lists collapsed folders without their children", () => {
    const rows = visibleRows(tree, new Set(), false);
    expect(rows.map((row) => [row.item.id, row.depth, row.open])).toEqual([
      ["z-folder", 0, false],
      ["a-note", 0, false],
      ["b-note", 0, false],
    ]);
  });

  it("lists the children of expanded folders", () => {
    const rows = visibleRows(tree, new Set(["z-folder"]), false);
    expect(rows.map((row) => [row.item.id, row.depth, row.open])).toEqual([
      ["z-folder", 0, true],
      ["inner", 1, false],
      ["a-note", 0, false],
      ["b-note", 0, false],
    ]);
  });

  it("opens every folder while searching", () => {
    const rows = visibleRows(tree, new Set(), true);
    expect(rows.map((row) => row.item.id)).toEqual([
      "z-folder",
      "inner",
      "a-note",
      "b-note",
    ]);
  });
});

describe("toOutline", () => {
  const items = [
    item("a", "note", null, { content: "one", updatedAt: 1 }),
    item("b", "note", null, { content: "two", updatedAt: 1 }),
  ];

  it("strips content", () => {
    expect(toOutline([], items, false).map((i) => i.content)).toEqual(["", ""]);
  });

  it("keeps the same array and items when only content changes", () => {
    const outline = toOutline([], items, false);
    const edited = [{ ...items[0], content: "x", updatedAt: 9 }, items[1]];

    expect(toOutline(outline, edited, false)).toBe(outline);
  });

  it("replaces only the item whose name changed", () => {
    const outline = toOutline([], items, false);
    const next = toOutline(outline, [{ ...items[0], name: "z" }, items[1]], false);

    expect(next).not.toBe(outline);
    expect(next[0].name).toBe("z");
    expect(next[1]).toBe(outline[1]);
  });

  it("tracks modified time only when sorting by it", () => {
    const outline = toOutline([], items, true);
    const touched = [{ ...items[0], updatedAt: 9 }, items[1]];
    const next = toOutline(outline, touched, true);

    expect(next).not.toBe(outline);
    expect(next[0].updatedAt).toBe(9);
    expect(next[1]).toBe(outline[1]);
  });

  it("refreshes a stale modified time when switching to sorting by it", () => {
    const outline = toOutline([], items, false);
    const touched = [{ ...items[0], updatedAt: 9 }, items[1]];
    const stale = toOutline(outline, touched, false);

    expect(stale).toBe(outline);
    const next = toOutline(stale, touched, true);
    expect(next[0].updatedAt).toBe(9);
    expect(next[1]).toBe(outline[1]);
  });

  it("follows removed and reordered items", () => {
    const outline = toOutline([], items, false);

    expect(toOutline(outline, [items[0]], false)).toHaveLength(1);
    expect(toOutline(outline, [items[1], items[0]], false)[0]).toBe(outline[1]);
  });
});
