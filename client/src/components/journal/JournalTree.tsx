import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TreeNodes, type TreeActions } from "@/components/journal/TreeNodes";
import { useJournal } from "@/context/JournalContext";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import { visibleRows } from "@/lib/journal/item";
import { focusRow } from "@/lib/journal/focus";
import { panesOf } from "@/lib/journal/layout";
import { treeKeyDown } from "@/lib/journal/treeKeyboard";
import type { JournalItem, JournalTreeNode } from "@/types/Journal";
import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export default memo(function JournalTree({
  nodes,
  searching,
  renamingId,
  dropTarget,
  actions,
}: {
  nodes: JournalTreeNode[];
  searching: boolean;
  renamingId: string | null;
  dropTarget: string | null | undefined;
  actions: TreeActions;
}) {
  const { t } = useTranslation();
  const { workspace, expanded, items } = useJournal();
  const [confirming, setConfirming] = useState<{
    item: JournalItem;
    next?: string;
  } | null>(null);
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

  const { onDelete, onToggle, onRename } = actions;

  const deleteItem = useCallback(
    (item: JournalItem) => {
      const index = rows.findIndex((row) => row.item.id === item.id);
      const after = rows
        .slice(index + 1)
        .find((row) => row.depth <= rows[index].depth);
      const next = (after ?? rows[index - 1])?.item.id;
      if (item.type === "folder" && items.some((i) => i.parentId === item.id)) {
        setConfirming({ item, next });
        return;
      }
      onDelete(item);
      if (next) focusRow(next);
    },
    [rows, onDelete, items],
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
      }),
    [rows, searching, onToggle, onRename, deleteItem],
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
      treeActions,
      onKeyDown,
    ],
  );

  return (
    <>
      <TreeNodes nodes={nodes} depth={0} view={view} />
      <AlertDialog
        open={!!confirming}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("journal.deleteFolderTitle", { name: confirming?.item.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("journal.deleteFolderDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirming) return;
                onDelete(confirming.item);
                if (confirming.next) focusRow(confirming.next);
              }}
            >
              {t("journal.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
