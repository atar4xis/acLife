import { isModKey } from "@/lib/utils";

export const HISTORY_LIMIT = 40;

export type History<T> = { past: T[]; future: T[] };

export const recordHistory = <T>(
  history: History<T>,
  entry: T,
): History<T> => ({
  past: [...history.past, entry].slice(-HISTORY_LIMIT),
  future: [],
});

export function undoRedoAction(e: KeyboardEvent): "undo" | "redo" | null {
  if (!isModKey(e) || e.altKey) return null;

  const key = e.key.toLowerCase();
  if (key === "y") return "redo";
  if (key !== "z") return null;
  return e.shiftKey ? "redo" : "undo";
}
