import { openContextMenu } from "@/lib/journal/focus";
import type { TreeRow } from "@/lib/journal/item";
import type { JournalItem } from "@/types/Journal";

type TreeKeyContext = {
  rows: TreeRow[];
  searching: boolean;
  onToggle: (item: JournalItem) => void;
  onRename: (id: string) => void;
  onDelete: (item: JournalItem) => void;
};

export const treeKeyDown = (
  e: React.KeyboardEvent<HTMLElement>,
  { rows, searching, onToggle, onRename, onDelete }: TreeKeyContext,
) => {
  const target = e.target as HTMLElement;
  const index = rows.findIndex((row) => row.item.id === target.dataset.itemId);
  if (index === -1 || e.ctrlKey || e.altKey || e.metaKey) return;

  const row = rows[index];
  const focus = (to: TreeRow | undefined) =>
    Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-item-id]"))
      .find((element) => element.dataset.itemId === to?.item.id)
      ?.focus();
  const isFolder = row.item.type === "folder";

  if (
    e.key === "ContextMenu" ||
    (e.key === "F10" && e.shiftKey) ||
    (e.key.toLowerCase() === "m" && !e.shiftKey)
  ) {
    openContextMenu(target);
  } else if (e.key === "ArrowDown") {
    focus(rows[index + 1]);
  } else if (e.key === "ArrowUp") {
    focus(rows[index - 1]);
  } else if (e.key === "Home") {
    focus(rows[0]);
  } else if (e.key === "End") {
    focus(rows.at(-1));
  } else if (e.key === "ArrowRight" && isFolder) {
    if (!row.open) onToggle(row.item);
    else if (rows[index + 1]?.depth > row.depth) focus(rows[index + 1]);
  } else if (e.key === "ArrowLeft") {
    if (isFolder && row.open && !searching) onToggle(row.item);
    else focus(rows.slice(0, index).findLast((r) => r.depth < row.depth));
  } else if (e.key === "F2") {
    onRename(row.item.id);
  } else if (e.key === "Delete") {
    onDelete(row.item);
  } else {
    return;
  }
  e.preventDefault();
};
