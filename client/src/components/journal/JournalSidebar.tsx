import UndoRedoButtons from "@/components/calendar/UndoRedoButtons";
import CustomizeDialog from "@/components/journal/CustomizeDialog";
import JournalToolbar from "@/components/journal/JournalToolbar";
import JournalTree from "@/components/journal/JournalTree";
import type { TreeActions } from "@/components/journal/TreeNodes";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import { ClipboardPaste } from "lucide-react";
import SelectionBox from "@/components/ui/selection-box";
import {
  SidebarContent,
  SidebarGroup,
  useSidebar,
} from "@/components/ui/sidebar";
import { useJournal, useJournalItems } from "@/context/JournalContext";
import { useTreeDrag } from "@/hooks/journal/useTreeDrag";
import { useSelectionBox } from "@/hooks/useSelectionBox";
import { buildTree, filterTree } from "@/lib/journal/item";
import { focusRow } from "@/lib/journal/focus";
import { undoRedoAction } from "@/lib/history";
import { shortcutsApply } from "@/lib/calendar/shortcutScope";
import { getKeyedRects } from "@/lib/selectionBox";
import { cn, isModKey } from "@/lib/utils";
import type { JournalItem, JournalTreeNode } from "@/types/Journal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type TreePaneProps = {
  searching: boolean;
  renamingId: string | null;
  dropTarget: string | null | undefined;
  selectedIds: ReadonlySet<string>;
  actions: TreeActions;
};

function TreePane({
  nodes,
  ...props
}: TreePaneProps & { nodes: JournalTreeNode[] }) {
  const { t } = useTranslation();

  if (nodes.length === 0)
    return (
      <p className="text-muted-foreground p-2 text-sm">
        {t(props.searching ? "journal.noMatches" : "journal.empty")}
      </p>
    );

  return (
    <nav aria-label={t("journal.notes")}>
      <JournalTree nodes={nodes} {...props} />
    </nav>
  );
}

function SearchResults({ query, ...props }: TreePaneProps & { query: string }) {
  const items = useJournalItems();
  const { sort } = useJournal();
  const nodes = useMemo(
    () => filterTree(buildTree(items, sort), query),
    [items, sort, query],
  );

  return <TreePane nodes={nodes} {...props} />;
}

export default function JournalSidebar() {
  const journal = useJournal();
  const { t } = useTranslation();
  const coarse = useCoarsePointer();
  const { isMobile, setOpenMobile } = useSidebar();
  const contentRef = useRef<HTMLDivElement>(null);
  const [clipboard, setClipboard] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const { dropTarget, dragProps, rootProps } = useTreeDrag(selectedIds);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [customizingId, setCustomizingId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);

  const searching = query.trim().length > 0;
  const tree = useMemo(
    () => buildTree(journal.items, journal.sort),
    [journal.items, journal.sort],
  );

  const clearSelection = useCallback(
    () => setSelectedIds((prev) => (prev.size ? new Set() : prev)),
    [],
  );

  const selectionBox = useSelectionBox<{
    base: ReadonlySet<string>;
    toggle?: string;
  }>({
    containerRef: contentRef,
    getRects: (container, offsetX, offsetY) =>
      getKeyedRects(
        container,
        "[data-item-id]",
        "data-item-id",
        offsetX,
        offsetY,
      ),
    onBox: (keys, { base }) => setSelectedIds(new Set([...base, ...keys])),
    onClick: ({ toggle }) => {
      if (!toggle) return;

      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (!next.delete(toggle)) next.add(toggle);
        return next;
      });
    },
  });

  const onTreePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    const row = (e.target as Element).closest<HTMLElement>("[data-item-id]");
    if (!isModKey(e)) {
      if (!row) clearSelection();
      return;
    }

    e.preventDefault();
    selectionBox.begin(e, {
      base: e.shiftKey ? selectedIds : new Set(),
      toggle: row?.dataset.itemId,
    });
  };

  const hasSelection = selectedIds.size > 0;

  useEffect(() => {
    if (!hasSelection) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) clearSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasSelection, clearSelection]);

  const { undo, redo } = journal;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const historyAction = undoRedoAction(e);
      if (!historyAction || e.defaultPrevented) return;

      const focusInTree = (e.target as Element).closest?.("[role=tree]");
      if (!focusInTree && !shortcutsApply(e.target)) return;

      e.preventDefault();
      if (historyAction === "redo") redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const createIn = useCallback(
    (type: JournalItem["type"], parentId: string | null) => {
      const id = journal.addItem(type, parentId);
      if (type === "note") journal.openNote(id, true);
      else setRenamingId(id);
    },
    [journal],
  );

  const create = (type: JournalItem["type"]) =>
    createIn(
      type,
      folderId && journal.itemsById.has(folderId) ? folderId : null,
    );

  const treeActions = useMemo<TreeActions>(
    () => ({
      dragProps,
      onRenamed: (item, name) => {
        setRenamingId(null);
        focusRow(item.id);
        if (name?.trim() && name !== item.name)
          journal.renameItem(item.id, name.trim());
      },
      onRename: (id) => setTimeout(() => setRenamingId(id)),
      onCreate: (type, parentId) => setTimeout(() => createIn(type, parentId)),
      onCustomize: (item) => setTimeout(() => setCustomizingId(item.id)),
      onOpen: (item, newTab) => {
        clearSelection();
        setFolderId(item.parentId);
        journal.openNote(item.id, newTab);
        if (isMobile) setOpenMobile(false);
      },
      onDelete: (item) => journal.removeItem(item.id),
      onCopy: (item) => {
        setClipboard(selectedIds.has(item.id) ? [...selectedIds] : [item.id]);
      },
      canPaste: clipboard.length > 0,
      onPaste: (item) =>
        journal.pasteItems(
          clipboard,
          item.type === "folder" ? item.id : item.parentId,
        ),
      onMove: (item, parentId) => journal.moveItem(item.id, parentId),
      onToggle: (item) => {
        clearSelection();
        setFolderId(item.id);
        journal.toggleFolder(item.id);
      },
    }),
    [
      dragProps,
      journal,
      isMobile,
      setOpenMobile,
      clearSelection,
      createIn,
      selectedIds,
      clipboard,
    ],
  );

  if (journal.loadFailed) return <SidebarContent />;

  return (
    <>
      <SidebarContent ref={contentRef} className="flex-1">
        <SidebarGroup>
          <JournalToolbar
            query={query}
            setQuery={setQuery}
            searching={searching}
            searchOpen={searchOpen}
            setSearchOpen={setSearchOpen}
            create={create}
          />
        </SidebarGroup>

        <ContextMenu>
          <ContextMenuTrigger asChild disabled={coarse}>
            <SidebarGroup
              className={cn(
                "flex-1",
                dropTarget === null && "ring-primary ring-1",
              )}
              {...rootProps}
              onPointerDown={onTreePointerDown}
            >
              {searching ? (
                <SearchResults
                  query={query}
                  searching
                  selectedIds={selectedIds}
                  renamingId={renamingId}
                  dropTarget={dropTarget}
                  actions={treeActions}
                />
              ) : (
                <TreePane
                  nodes={tree}
                  searching={false}
                  selectedIds={selectedIds}
                  renamingId={renamingId}
                  dropTarget={dropTarget}
                  actions={treeActions}
                />
              )}
            </SidebarGroup>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              disabled={clipboard.length === 0}
              onSelect={() => journal.pasteItems(clipboard, null)}
            >
              <ClipboardPaste />
              {t("common.paste")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <SelectionBox box={selectionBox.box} />
        {customizingId && journal.itemsById.has(customizingId) && (
          <CustomizeDialog
            key={customizingId}
            item={journal.itemsById.get(customizingId)!}
            onClose={() => setCustomizingId(null)}
          />
        )}
      </SidebarContent>
      {isMobile && (
        <UndoRedoButtons
          className="absolute"
          canUndo={journal.canUndo}
          canRedo={journal.canRedo}
          onUndo={undo}
          onRedo={redo}
        />
      )}
    </>
  );
}
