import { TreeNodes, type TreeActions } from "@/components/journal/TreeNodes";
import { useJournal } from "@/context/JournalContext";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import { visibleRows } from "@/lib/journal/item";
import { focusRow } from "@/lib/journal/focus";
import { panesOf } from "@/lib/journal/layout";
import { treeKeyDown } from "@/lib/journal/treeKeyboard";
import type { JournalItem, JournalTreeNode } from "@/types/Journal";
import { memo, useCallback, useMemo, useState } from "react";

export default memo(function JournalTree({
  nodes,
  searching,
  renamingId,
  dropTarget,
  selectedIds,
  actions,
}: {
  nodes: JournalTreeNode[];
  searching: boolean;
  renamingId: string | null;
  dropTarget: string | null | undefined;
  selectedIds: ReadonlySet<string>;
  actions: TreeActions;
}) {
  const { workspace, expanded, itemsById } = useJournal();
  const coarse = useCoarsePointer();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const activeId = panesOf(workspace.layout).find(
    (pane) => pane.id === workspace.focused,
  )?.active;
  const rows = useMemo(
    () => visibleRows(nodes, expanded, searching),
    [nodes, expanded, searching],
  );
  const tabStopId = [focusedId, activeId, rows[0].item.id].find((id) =>
    rows.some((row) => row.item.id === id),
  )!;

  const { onDelete, onToggle, onRename, onCopy, onPaste, canPaste } = actions;

  const deleteItem = useCallback(
    (item: JournalItem) => {
      const index = rows.findIndex((row) => row.item.id === item.id);
      const after = rows
        .slice(index + 1)
        .find((row) => row.depth <= rows[index].depth);
      const next = (after ?? rows[index - 1])?.item.id;
      onDelete(item);
      if (next) focusRow(next);
    },
    [rows, onDelete],
  );

  const treeActions = useMemo<TreeActions>(
    () => ({ ...actions, onDelete: deleteItem }),
    [actions, deleteItem],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) =>
      treeKeyDown(e, {
        rows,
        searching,
        onToggle,
        onRename,
        onDelete: deleteItem,
        onCopy,
        onPaste,
        canPaste,
        itemsById,
      }),
    [
      rows,
      searching,
      onToggle,
      onRename,
      deleteItem,
      onCopy,
      onPaste,
      canPaste,
      itemsById,
    ],
  );

  const view = useMemo(
    () => ({
      searching,
      renamingId,
      dropTarget,
      coarse,
      activeId,
      expanded,
      tabStopId,
      selectedIds,
      actions: treeActions,
      onFocusRow: setFocusedId,
      onKeyDown,
    }),
    [
      searching,
      renamingId,
      dropTarget,
      coarse,
      activeId,
      expanded,
      tabStopId,
      selectedIds,
      treeActions,
      onKeyDown,
    ],
  );

  return (
    <>
      <TreeNodes nodes={nodes} depth={0} view={view} />
    </>
  );
});
