import { isModKey } from "@/lib/utils";
import { openContextMenu } from "@/lib/journal/focus";
import type { TreeRow } from "@/lib/journal/item";
import { canCreateIn, canDeleteItem, canEditItem } from "@/lib/journal/shared";
import type { JournalItem } from "@/types/Journal";

type TreeKeyContext = {
  rows: TreeRow[];
  searching: boolean;
  onToggle: (item: JournalItem) => void;
  onRename: (id: string) => void;
  onDelete: (item: JournalItem) => void;
  onCopy: (item: JournalItem) => void;
  onPaste: (item: JournalItem) => void;
  canPaste: boolean;
  itemsById: ReadonlyMap<string, JournalItem>;
};

export const treeKeyDown = (
  e: React.KeyboardEvent<HTMLElement>,
  {
    rows,
    searching,
    onToggle,
    onRename,
    onDelete,
    onCopy,
    onPaste,
    canPaste,
    itemsById,
  }: TreeKeyContext,
) => {
  const target = e.target as HTMLElement;
  const index = rows.findIndex((row) => row.item.id === target.dataset.itemId);
  if (index === -1 || e.altKey) return;

  const row = rows[index];
  if (isModKey(e)) {
    const key = e.key.toLowerCase();
    if (e.shiftKey || (key !== "c" && key !== "v")) return;

    if (key === "c") {
      onCopy(row.item);
    } else {
      const pasteTarget =
        row.item.type === "folder"
          ? row.item
          : itemsById.get(row.item.parentId ?? "");
      if (!canPaste || (pasteTarget && !canCreateIn(pasteTarget))) return;
      onPaste(row.item);
    }
    e.preventDefault();
    return;
  }

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
  } else if (e.key === "F2" && canEditItem(row.item)) {
    onRename(row.item.id);
  } else if (e.key === "Delete" && canDeleteItem(row.item)) {
    onDelete(row.item);
  } else {
    return;
  }
  e.preventDefault();
};
