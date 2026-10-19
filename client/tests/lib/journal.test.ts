import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTree,
  colorChanged,
  canMoveItem,
  descendantIds,
  filterTree,
  folderTargets,
  itemIconName,
  itemStyle,
  moveTargets,
  noteName,
  toOutline,
  topLevelItems,
  visibleRows,
} from "../../src/lib/journal/item.ts";
import { defaultJournalSettings } from "../../src/lib/settingsDefaults.ts";
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

  describe("shared folders", () => {
    const own = [
      item("a-own", "folder", null, { updatedAt: 50, createdAt: 50 }),
      item("z-own", "folder", null, { updatedAt: 60, createdAt: 60 }),
      item("m-note", "note", null, { updatedAt: 70, createdAt: 70 }),
    ];
    const virtual = [
      item("shared:b", "folder", null, { name: "Shared by b", _virtual: true, updatedAt: 10, createdAt: 10 }),
      item("shared:a", "folder", null, { name: "Shared by a", _virtual: true, updatedAt: 20, createdAt: 5 }),
    ];

    it("sits above everything of mine and is ordered on its own", () => {
      const tree = buildTree([...own, ...virtual], "name-asc");
      expect(ids(tree)).toEqual(["shared:a", "shared:b", "a-own", "z-own", "m-note"]);
    });

    it("keeps above mine whichever way it is sorted", () => {
      for (const sort of ["name-desc", "modified-desc", "modified-asc", "created-desc", "created-asc"] as const) {
        const tree = buildTree([...own, ...virtual], sort);
        expect(ids(tree).slice(0, 2).toSorted()).toEqual(["shared:a", "shared:b"]);
        expect(ids(tree).slice(2).toSorted()).toEqual(["a-own", "m-note", "z-own"]);
      }
    });

    it("follows the sort preference among the shared folders", () => {
      expect(ids(buildTree(virtual, "name-desc"))).toEqual(["shared:b", "shared:a"]);
      expect(ids(buildTree(virtual, "modified-desc"))).toEqual(["shared:a", "shared:b"]);
      expect(ids(buildTree(virtual, "created-asc"))).toEqual(["shared:a", "shared:b"]);
      expect(ids(buildTree(virtual, "created-desc"))).toEqual(["shared:b", "shared:a"]);
    });

    it("does not let my own folders change the order of the shared ones", () => {
      const withMine = buildTree([...own, ...virtual], "modified-desc");
      const alone = buildTree(virtual, "modified-desc");
      expect(ids(withMine).slice(0, 2)).toEqual(ids(alone));
    });
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

  it("keeps only selected items whose ancestors are not selected", () => {
    const picked = topLevelItems(
      items,
      new Set(["z-folder", "inner", "a-note"]),
    );

    expect(picked.map((found) => found.id)).toEqual(["a-note", "z-folder"]);
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

  it.each([
    ["icon", "Star"],
    ["color", "#111111"],
    ["background", "#222222"],
    ["colorIcon", false],
  ])("replaces the item when its %s changed", (key, value) => {
    const outline = toOutline([], items, false);
    const next = toOutline(outline, [{ ...items[0], [key]: value }, items[1]], false);

    expect(next[0]).toMatchObject({ [key]: value });
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

describe("note defaults", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats dates in braces", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-03-04T10:00:00Z"));

    expect(noteName(defaultJournalSettings.journalNoteName)).toBe("4 Mar 2026");
    expect(noteName("Log {YYYY-MM-DD}")).toBe("Log 2026-03-04");
    expect(noteName("Log [YYYY]")).toBe("Log [YYYY]");
    expect(noteName("{DD}/{MM}/{YY} notes")).toBe("04/03/26 notes");
    expect(noteName("   ")).toBe("Untitled");
  });

  it("stores only what differs from the built-in look", () => {
    const base = defaultJournalSettings;

    expect(itemStyle("note", base)).toEqual({});
    expect(
      itemStyle("folder", {
        ...base,
        journalFolderIcon: "Archive",
        journalForegroundEnabled: true,
        journalForeground: "#111111",
        journalColorIcons: false,
        journalBackgroundEnabled: true,
        journalBackground: "#eeeeee",
      }),
    ).toEqual({
      icon: "Archive",
      color: "#111111",
      colorIcon: false,
      background: "#eeeeee",
    });
  });

  it("lists the root and every folder with its depth", () => {
    const targets = folderTargets(items, "name-asc");

    expect(targets[0]).toEqual({ folder: null, depth: 0 });
    expect(targets.every(({ folder }) => !folder || folder.type === "folder")).toBe(true);
    expect(targets.length).toBeGreaterThan(1);
  });

  it("only the default folder icon has an open state", () => {
    const plain = item("f", "folder", null);
    const custom = item("g", "folder", null, { icon: "Archive" });

    expect(itemIconName(plain, false)).toBe("Folder");
    expect(itemIconName(plain, true)).toBe("FolderOpen");
    expect(itemIconName(custom, false)).toBe("Archive");
    expect(itemIconName(custom, true)).toBe("Archive");
  });

  it("ignores the color while its switch is off", () => {
    expect(colorChanged(false, "#111111", false, "#222222")).toBe(false);
    expect(colorChanged(true, "#111111", false, "#111111")).toBe(true);
    expect(colorChanged(true, "#111111", true, "#222222")).toBe(true);
    expect(colorChanged(true, "#111111", true, "#111111")).toBe(false);
  });
});
