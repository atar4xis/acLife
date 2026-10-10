import { describe, expect, it } from "vitest";
import {
  activateTab,
  addNewTab,
  canDrop,
  isNewTab,
  moveOptions,
  closeNotes,
  closeTab,
  createWorkspace,
  dropOnPane,
  dropOnTabs,
  dropZone,
  openNote,
  panesOf,
  restoreWorkspace,
  setReading,
} from "../../src/lib/journal/layout.ts";
import type { Workspace } from "../../src/types/Journal.ts";

const tabs = (ws: Workspace) => panesOf(ws.layout).map((pane) => pane.tabs);
const firstPane = (ws: Workspace) => panesOf(ws.layout)[0].id;

const open = (...ids: string[]) =>
  ids.reduce((ws, id) => openNote(ws, id, true), createWorkspace());

describe("journal layout", () => {
  it("opens in a new tab or replaces the active tab", () => {
    let ws = open("a", "b");
    expect(tabs(ws)).toEqual([["a", "b"]]);

    ws = openNote(ws, "c", false);
    expect(tabs(ws)).toEqual([["a", "c"]]);
    expect(panesOf(ws.layout)[0].active).toBe("c");
  });

  it("activates a note that is already open, in whichever pane has it", () => {
    let ws = open("a", "b");
    ws = dropOnPane(
      ws,
      { id: "b", fromPane: firstPane(ws) },
      firstPane(ws),
      "right",
    );
    const [left, right] = panesOf(ws.layout);

    ws = activateTab(ws, left.id, "a");
    ws = openNote(ws, "b", false);
    expect(ws.focused).toBe(right.id);
    expect(tabs(ws)).toEqual([["a"], ["b"]]);
  });

  it("closes tabs, picks a neighbor and removes emptied panes", () => {
    let ws = open("a", "b", "c");
    const pane = firstPane(ws);
    ws = closeTab(ws, pane, "c");
    expect(panesOf(ws.layout)[0].active).toBe("b");

    ws = dropOnPane(ws, { id: "b", fromPane: pane }, pane, "bottom");
    expect(tabs(ws)).toEqual([["a"], ["b"]]);

    ws = closeTab(ws, panesOf(ws.layout)[1].id, "b");
    expect(ws.layout.kind).toBe("pane");
    expect(ws.focused).toBe(pane);

    ws = closeTab(ws, pane, "a");
    expect(tabs(ws)).toEqual([[]]);
  });

  it("splits towards the dropped edge", () => {
    const base = open("a", "b");
    const pane = firstPane(base);
    const drag = { id: "b", fromPane: pane };

    for (const [zone, direction, order] of [
      ["left", "row", [["b"], ["a"]]],
      ["right", "row", [["a"], ["b"]]],
      ["top", "column", [["b"], ["a"]]],
      ["bottom", "column", [["a"], ["b"]]],
    ] as const) {
      const ws = dropOnPane(base, drag, pane, zone);
      expect(ws.layout.kind === "split" && ws.layout.direction).toBe(direction);
      expect(tabs(ws)).toEqual(order);
    }
  });

  it("cannot split a pane with its only tab or move onto itself", () => {
    const ws = open("a");
    const pane = firstPane(ws);
    expect(dropOnPane(ws, { id: "a", fromPane: pane }, pane, "right")).toBe(ws);
    const two = open("a", "b");
    expect(
      dropOnPane(
        two,
        { id: "a", fromPane: firstPane(two) },
        firstPane(two),
        "center",
      ),
    ).toBe(two);
  });

  it("opens a note dragged from the tree in the target pane", () => {
    let ws = open("a");
    const pane = firstPane(ws);
    ws = dropOnPane(ws, { id: "b" }, pane, "center");
    expect(tabs(ws)).toEqual([["a", "b"]]);

    ws = dropOnPane(ws, { id: "c" }, pane, "right");
    expect(tabs(ws)).toEqual([["a", "b"], ["c"]]);
    expect(ws.focused).toBe(panesOf(ws.layout)[1].id);
  });

  it("moves tabs between panes and flattens same-direction splits", () => {
    let ws = open("a", "b", "c");
    const pane = firstPane(ws);
    ws = dropOnPane(ws, { id: "b", fromPane: pane }, pane, "right");
    ws = dropOnPane(
      ws,
      { id: "c", fromPane: pane },
      panesOf(ws.layout)[1].id,
      "right",
    );
    expect(ws.layout.kind === "split" && ws.layout.children).toHaveLength(3);

    const [, middle, last] = panesOf(ws.layout);
    ws = dropOnPane(ws, { id: "c", fromPane: last.id }, middle.id, "center");
    expect(tabs(ws)).toEqual([["a"], ["b", "c"]]);
  });

  it("reorders tabs by drop index", () => {
    let ws = open("a", "b", "c");
    const pane = firstPane(ws);

    ws = dropOnTabs(ws, { id: "a", fromPane: pane }, pane, 3);
    expect(tabs(ws)).toEqual([["b", "c", "a"]]);

    ws = dropOnTabs(ws, { id: "a", fromPane: pane }, pane, 1);
    expect(tabs(ws)).toEqual([["b", "a", "c"]]);

    ws = dropOnTabs(ws, { id: "b", fromPane: pane }, pane, 2);
    expect(tabs(ws)).toEqual([["a", "b", "c"]]);

    ws = dropOnTabs(ws, { id: "d" }, pane, 1);
    expect(tabs(ws)).toEqual([["a", "d", "b", "c"]]);
  });

  it("removes deleted notes from every pane", () => {
    let ws = open("a", "b");
    ws = dropOnPane(
      ws,
      { id: "b", fromPane: firstPane(ws) },
      firstPane(ws),
      "right",
    );
    ws = closeNotes(ws, ["a", "b"]);
    expect(tabs(ws)).toEqual([[]]);
  });

  it("adds empty tabs that can be moved like notes", () => {
    let ws = open("a");
    const pane = firstPane(ws);
    ws = addNewTab(ws, pane);
    const [a, empty] = panesOf(ws.layout)[0].tabs;
    expect(a).toBe("a");
    expect(isNewTab(empty)).toBe(true);
    expect(panesOf(ws.layout)[0].active).toBe(empty);

    ws = dropOnPane(ws, { id: empty, fromPane: pane }, pane, "right");
    expect(tabs(ws)).toEqual([["a"], [empty]]);

    ws = openNote(ws, "b", false);
    expect(tabs(ws)).toEqual([["a"], ["b"]]);
  });

  it("treats a lone split dragged back to where it already is as a no-op", () => {
    let ws = open("a", "b");
    ws = dropOnPane(
      ws,
      { id: "b", fromPane: firstPane(ws) },
      firstPane(ws),
      "right",
    );
    const [left, right] = panesOf(ws.layout);
    const drag = { id: "b", fromPane: right.id };

    expect(canDrop(ws, drag, left.id, "right")).toBe(false);
    expect(dropOnPane(ws, drag, left.id, "right")).toBe(ws);
    expect(canDrop(ws, drag, left.id, "left")).toBe(true);
    expect(canDrop(ws, drag, left.id, "bottom")).toBe(true);
    expect(tabs(dropOnPane(ws, drag, left.id, "left"))).toEqual([["b"], ["a"]]);
  });

  it("sets reading mode per pane", () => {
    let ws = open("a", "b");
    ws = dropOnPane(
      ws,
      { id: "b", fromPane: firstPane(ws) },
      firstPane(ws),
      "right",
    );
    const [left, right] = panesOf(ws.layout);

    ws = setReading(ws, right.id, true);
    expect(panesOf(ws.layout).map((pane) => !!pane.reading)).toEqual([
      false,
      true,
    ]);

    ws = dropOnPane(ws, { id: "a", fromPane: left.id }, right.id, "bottom");
    expect(panesOf(ws.layout).map((pane) => !!pane.reading)).toEqual([
      true,
      false,
    ]);
  });

  it("restores a saved workspace without notes that no longer exist", () => {
    let ws = open("a", "gone", "b");
    ws = addNewTab(ws, firstPane(ws));
    ws = dropOnPane(
      ws,
      { id: "gone", fromPane: firstPane(ws) },
      firstPane(ws),
      "right",
    );
    ws = setReading(ws, panesOf(ws.layout)[0].id, true);
    const saved = JSON.parse(JSON.stringify(ws));

    const stale = JSON.parse(JSON.stringify(saved));
    stale.layout.children[0].active = "gone";
    expect(
      panesOf(restoreWorkspace(stale, (id) => id !== "gone").layout)[0].active,
    ).toBe("a");

    const restored = restoreWorkspace(saved, (id) => id !== "gone");
    const panes = panesOf(restored.layout);
    expect(panes).toHaveLength(1);
    expect(panes[0].tabs.slice(0, 2)).toEqual(["a", "b"]);
    expect(panes[0].tabs).toHaveLength(3);
    expect(isNewTab(panes[0].tabs[2])).toBe(true);
    expect(panes[0].reading).toBe(true);
    expect(restored.focused).toBe(panes[0].id);

    const everyGone = restoreWorkspace(saved, () => false);
    expect(panesOf(everyGone.layout)[0].tabs.every(isNewTab)).toBe(true);
  });

  it("picks the zone from the pointer position", () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(dropZone(rect, 50, 50)).toBe("center");
    expect(dropZone(rect, 5, 50)).toBe("left");
    expect(dropZone(rect, 95, 50)).toBe("right");
    expect(dropZone(rect, 50, 5)).toBe("top");
    expect(dropZone(rect, 50, 95)).toBe("bottom");
  });
});

describe("move options", () => {
  const split = () => {
    let ws = open("a", "b", "c");
    ws = dropOnPane(
      ws,
      { id: "c", fromPane: firstPane(ws) },
      firstPane(ws),
      "right",
    );
    return ws;
  };

  it("offers every split and no other pane for a lone tab", () => {
    const ws = open("a");
    const pane = firstPane(ws);

    expect(moveOptions(ws, { id: "a", fromPane: pane }, pane)).toEqual({
      zones: [],
      panes: [],
    });
  });

  it("offers new splits of its own pane and the other panes for a tab", () => {
    const ws = split();
    const [left, right] = panesOf(ws.layout);

    expect(moveOptions(ws, { id: "a", fromPane: left.id }, left.id)).toEqual({
      zones: ["left", "right", "top", "bottom"],
      panes: [{ id: right.id, number: 2 }],
    });
    expect(moveOptions(ws, { id: "c", fromPane: right.id }, right.id)).toEqual({
      zones: [],
      panes: [{ id: left.id, number: 1 }],
    });
  });

  it("offers all splits and panes to a note that is not open", () => {
    const ws = split();
    const [left, right] = panesOf(ws.layout);

    expect(moveOptions(ws, { id: "closed" }, right.id)).toEqual({
      zones: ["left", "right", "top", "bottom"],
      panes: [
        { id: left.id, number: 1 },
        { id: right.id, number: 2 },
      ],
    });
  });
});
