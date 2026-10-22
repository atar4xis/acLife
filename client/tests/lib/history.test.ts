import { describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  recordHistory,
  undoRedoAction,
} from "../../src/lib/history.ts";

const press = (key: string, mods: Partial<KeyboardEvent> = {}) =>
  undoRedoAction({ key, ...mods } as KeyboardEvent);

describe("undoRedoAction", () => {
  it.each([
    ["z", { ctrlKey: true }, "undo"],
    ["Z", { metaKey: true }, "undo"],
    ["z", { ctrlKey: true, shiftKey: true }, "redo"],
    ["Z", { metaKey: true, shiftKey: true }, "redo"],
    ["y", { ctrlKey: true }, "redo"],
    ["y", { metaKey: true }, "redo"],
    ["z", {}, null],
    ["y", {}, null],
    ["z", { ctrlKey: true, altKey: true }, null],
    ["c", { ctrlKey: true }, null],
  ])("maps %s with %j", (key, mods, expected) => {
    expect(press(key, mods)).toBe(expected);
  });
});

describe("recordHistory", () => {
  it("appends, clears redo and caps the past", () => {
    const full = { past: Array.from({ length: HISTORY_LIMIT }, (_, i) => i), future: [1] };
    const next = recordHistory(full, 99);
    expect(next.past).toHaveLength(HISTORY_LIMIT);
    expect(next.past.at(-1)).toBe(99);
    expect(next.past[0]).toBe(1);
    expect(next.future).toEqual([]);
  });
});
