import { describe, expect, it } from "vitest";
import {
  admitJoined,
  admitMirrored,
  canCreateIn,
  canDeleteItem,
  canEditItem,
  canMoveInto,
  coveredItems,
  isOwnItem,
  placeShared,
  haveSameItems,
  sharedRootId,
  toSharedItem,
} from "../../src/lib/journal/shared";
import type { JournalItem } from "../../src/types/Journal";
import type { SharedInfo } from "../../src/types/Share";

const item = (id: string, extra: Partial<JournalItem> = {}): JournalItem => ({
  id,
  parentId: null,
  type: "note",
  name: id,
  content: "",
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

const info = (extra: Partial<SharedInfo> = {}): SharedInfo => ({
  space: "s1",
  owner: "o1",
  scope: "collection",
  permission: "write",
  ...extra,
});

const shared = (id: string, extra: Partial<SharedInfo> = {}, rest: Partial<JournalItem> = {}) =>
  item(id, { _shared: info(extra), ...rest });

describe("permissions", () => {
  it("lets owners do everything with their own items", () => {
    expect(canEditItem(item("a"))).toBe(true);
    expect(canDeleteItem(item("a"))).toBe(true);
    expect(canCreateIn(item("a"))).toBe(true);
    expect(canCreateIn(undefined)).toBe(true);
  });

  it("lets a read member do nothing", () => {
    const note = shared("a", { permission: "read" });
    expect(canEditItem(note)).toBe(false);
    expect(canDeleteItem(note)).toBe(false);
    expect(canCreateIn(note)).toBe(false);
  });

  it("lets a write member of an item edit only", () => {
    const note = shared("a", { scope: "item" });
    expect(canEditItem(note)).toBe(true);
    expect(canDeleteItem(note)).toBe(false);
    expect(canCreateIn(note)).toBe(false);
  });

  it("lets a write member of a collection edit, create and delete", () => {
    const note = shared("a");
    expect(canEditItem(note)).toBe(true);
    expect(canDeleteItem(note)).toBe(true);
    expect(canCreateIn(note)).toBe(true);
  });

  it("never lets anyone change the virtual owner folders", () => {
    const root = item(sharedRootId("o1"), { type: "folder", _virtual: true });
    expect(canEditItem(root)).toBe(false);
    expect(canDeleteItem(root)).toBe(false);
    expect(canCreateIn(root)).toBe(false);
  });

  it("keeps shared items inside their space and own items outside shared ones", () => {
    const own = item("own");
    const a = shared("a");
    const sameSpace = shared("f", {}, { type: "folder" });
    const otherSpace = shared("g", { space: "s2" }, { type: "folder" });

    expect(canMoveInto(a, sameSpace)).toBe(true);
    expect(canMoveInto(a, otherSpace)).toBe(false);
    expect(canMoveInto(a, null)).toBe(false);
    expect(canMoveInto(own, null)).toBe(true);
    expect(canMoveInto(own, sameSpace)).toBe(false);
    expect(canMoveInto(own, item("x", { type: "folder", _virtual: true }))).toBe(false);
    expect(canMoveInto(shared("a", { scope: "item" }), sameSpace)).toBe(false);
    expect(canMoveInto(shared("a", { permission: "read" }), sameSpace)).toBe(false);
  });
});

describe("coveredItems", () => {
  const folder = item("f", { type: "folder" });
  const inside = item("i", { parentId: "f" });
  const deep = item("d", { parentId: "i" });
  const outside = item("o");
  const all = [folder, inside, deep, outside, shared("s")];

  it("covers everything of mine for the whole journal", () => {
    expect(coveredItems(all, null, "collection").map((i) => i.id)).toEqual(["f", "i", "d", "o"]);
  });

  it("covers a folder with everything below it", () => {
    expect(coveredItems(all, "f", "collection").map((i) => i.id)).toEqual(["f", "i", "d"]);
  });

  it("covers only the one note for an item", () => {
    expect(coveredItems(all, "f", "item").map((i) => i.id)).toEqual(["f"]);
  });

  it("never covers what others shared with me", () => {
    expect(coveredItems(all, null, "collection").some((i) => i._shared)).toBe(false);
  });
});

describe("runtime fields", () => {
  it("marks shared items", () => {
    expect(toSharedItem(item("a"), info())._shared?.space).toBe("s1");
  });

  it("tells own items from shared and virtual ones", () => {
    expect(isOwnItem(item("a"))).toBe(true);
    expect(isOwnItem(shared("a"))).toBe(false);
    expect(isOwnItem(item("a", { _virtual: true }))).toBe(false);
  });
});

describe("placeShared", () => {
  const emails = new Map([["o1", "owner@example.com"]]);

  it("returns the same array when nothing is shared", () => {
    const items = [item("a")];
    expect(placeShared(items, emails)).toBe(items);
  });

  it("puts top level shared items under a virtual folder of their owner", () => {
    const a = shared("a");
    const placed = placeShared([item("own"), a], emails);

    const root = placed.find((i) => i._virtual)!;
    expect(root).toMatchObject({
      id: sharedRootId("o1"),
      type: "folder",
      parentId: null,
    });
    expect(root.name).toContain("owner@example.com");
    expect(placed.find((i) => i.id === "a")?.parentId).toBe(root.id);
    expect(placed.find((i) => i.id === "own")?.parentId).toBeNull();
  });

  it("keeps the parent of items whose parent is shared too", () => {
    const folder = shared("f", {}, { type: "folder" });
    const child = shared("c", {}, { parentId: "f" });
    const placed = placeShared([folder, child], emails);

    expect(placed.find((i) => i.id === "c")?.parentId).toBe("f");
    expect(placed.find((i) => i.id === "f")?.parentId).toBe(sharedRootId("o1"));
  });

  it("dates the folder of an owner by the newest and oldest item inside", () => {
    const placed = placeShared(
      [
        shared("a", {}, { createdAt: 3, updatedAt: 90 }),
        shared("b", {}, { createdAt: 5, updatedAt: 50 }),
        shared("d", {}, { createdAt: 4, updatedAt: 60 }),
        shared("c", { owner: "o2", space: "s2" }, { createdAt: 8, updatedAt: 20 }),
      ],
      emails,
    );

    expect(placed.find((i) => i.id === sharedRootId("o1"))).toMatchObject({ createdAt: 3, updatedAt: 90 });
    expect(placed.find((i) => i.id === sharedRootId("o2"))).toMatchObject({ createdAt: 8, updatedAt: 20 });
  });

  it("makes one virtual folder per owner", () => {
    const placed = placeShared(
      [shared("a"), shared("b"), shared("c", { owner: "o2", space: "s2" })],
      emails,
    );
    expect(placed.filter((i) => i._virtual).map((i) => i.id).toSorted()).toEqual(
      [sharedRootId("o1"), sharedRootId("o2")],
    );
  });

  it("reuses the same placed object for the same item and parent", () => {
    const a = shared("a");
    const first = placeShared([a], emails).find((i) => i.id === "a");
    const second = placeShared([a], emails).find((i) => i.id === "a");
    expect(first).toBe(second);
  });

  it("does not change the real parent of the item", () => {
    const a = shared("a");
    placeShared([a], emails);
    expect(a.parentId).toBeNull();
  });
});

describe("admitJoined", () => {
  it("drops records that take the id of one of my own items", () => {
    const mine = item("mine");
    const theirs = shared("theirs");
    const forged = shared("mine");
    expect(admitJoined([mine, theirs], "s1", [forged, theirs])).toEqual([
      theirs,
    ]);
  });

  it("drops records that take the id of an item from another space", () => {
    const other = shared("other", { space: "s2" });
    const forged = shared("other");
    const fresh = shared("fresh");
    expect(admitJoined([other], "s1", [forged, fresh])).toEqual([fresh]);
  });
});

describe("admitMirrored", () => {
  const folder = item("folder", { type: "folder" });
  const inside = item("inside", { parentId: "folder" });
  const outside = item("outside");
  const mine = [folder, inside, outside];

  it("takes edits of covered notes and notes created inside the folder", () => {
    const edit = { ...inside, content: "edit" };
    const created = item("new", { parentId: "folder" });
    expect(admitMirrored(mine, "folder", "collection", [edit, created])).toEqual([
      edit,
      created,
    ]);
  });

  it("takes a note created inside a folder that was created in the same batch", () => {
    const sub = item("sub", { type: "folder", parentId: "folder" });
    const deep = item("deep", { parentId: "sub" });
    expect(
      admitMirrored(mine, "folder", "collection", [deep, sub]).map((i) => i.id).toSorted(),
    ).toEqual(["deep", "sub"]);
  });

  it("refuses notes that replace my uncovered ones or sit outside the folder", () => {
    const replace = { ...outside, content: "replaced" };
    const stray = item("stray");
    const elsewhere = item("elsewhere", { parentId: "outside" });
    expect(
      admitMirrored(mine, "folder", "collection", [replace, stray, elsewhere]),
    ).toEqual([]);
  });

  it("refuses records that take the id of an item joined from another space", () => {
    const joined = shared("joined", { space: "s2" });
    const forged = item("joined", { parentId: "folder", content: "forged" });
    expect(admitMirrored([...mine, joined], "folder", "collection", [forged])).toEqual([]);
    expect(admitMirrored([...mine, joined], null, "collection", [{ ...forged, parentId: null }])).toEqual([]);
  });

  it("refuses moving a covered note outside the folder", () => {
    expect(
      admitMirrored(mine, "folder", "collection", [{ ...inside, parentId: null }]),
    ).toEqual([]);
  });

  it("refuses moving a covered note under a note I did not share", () => {
    expect(
      admitMirrored(mine, "folder", "collection", [{ ...inside, parentId: "outside" }]),
    ).toEqual([]);
  });

  it("lets the shared root keep its place", () => {
    const moved = item("child", { parentId: "folder" });
    const nested = item("folder", { parentId: "elsewhere" });
    expect(admitMirrored([nested, moved], "folder", "collection", [nested])).toEqual([nested]);
  });

  it("only takes edits of the one note of an item space", () => {
    const edit = { ...outside, content: "edit" };
    const created = item("new", { parentId: "outside" });
    expect(admitMirrored(mine, "outside", "item", [edit, created])).toEqual([edit]);
  });

  it("takes anything, even at the root, for the whole journal", () => {
    const created = item("new");
    const replace = { ...outside, content: "edit" };
    expect(admitMirrored(mine, null, "collection", [created, replace])).toEqual([
      created,
      replace,
    ]);
  });
});

describe("haveSameItems", () => {
  const a = item("a");
  const b = item("b");

  it("is true for the same items in the same order", () => {
    expect(haveSameItems([a, b], [a, b])).toBe(true);
  });

  it("is false when an item was replaced by a copy", () => {
    expect(haveSameItems([a, b], [a, { ...b }])).toBe(false);
  });

  it("is false when the length differs", () => {
    expect(haveSameItems([a], [a, b])).toBe(false);
  });
});
