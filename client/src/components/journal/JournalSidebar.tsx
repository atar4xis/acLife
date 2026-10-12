import CustomizeDialog from "@/components/journal/CustomizeDialog";
import JournalToolbar from "@/components/journal/JournalToolbar";
import JournalTree from "@/components/journal/JournalTree";
import type { TreeActions } from "@/components/journal/TreeNodes";
import {
  SidebarContent,
  SidebarGroup,
  useSidebar,
} from "@/components/ui/sidebar";
import { useJournal, useJournalItems } from "@/context/JournalContext";
import { useTreeDrag } from "@/hooks/journal/useTreeDrag";
import { buildTree, filterTree } from "@/lib/journal/item";
import { focusRow } from "@/lib/journal/focus";
import { cn } from "@/lib/utils";
import type { JournalItem, JournalTreeNode } from "@/types/Journal";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type TreePaneProps = {
  searching: boolean;
  renamingId: string | null;
  dropTarget: string | null | undefined;
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
  const { isMobile, setOpenMobile } = useSidebar();
  const { dropTarget, dragProps, rootProps } = useTreeDrag();
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

  const create = useCallback(
    (type: JournalItem["type"]) => {
      const parentId =
        folderId && journal.itemsById.has(folderId) ? folderId : null;
      const id = journal.addItem(type, parentId);
      if (type === "note") journal.openNote(id, true);
      else setRenamingId(id);
    },
    [journal, folderId],
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
      onCustomize: (item) => setTimeout(() => setCustomizingId(item.id)),
      onOpen: (item, newTab) => {
        setFolderId(item.parentId);
        journal.openNote(item.id, newTab);
        if (isMobile) setOpenMobile(false);
      },
      onDelete: (item) => journal.removeItem(item.id),
      onMove: (item, parentId) => journal.moveItem(item.id, parentId),
      onToggle: (item) => {
        setFolderId(item.id);
        journal.toggleFolder(item.id);
      },
    }),
    [dragProps, journal, isMobile, setOpenMobile],
  );

  if (journal.loadFailed) return <SidebarContent />;

  return (
    <SidebarContent>
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

      <SidebarGroup
        className={cn("flex-1", dropTarget === null && "ring-primary ring-1")}
        {...rootProps}
      >
        {searching ? (
          <SearchResults
            query={query}
            searching
            renamingId={renamingId}
            dropTarget={dropTarget}
            actions={treeActions}
          />
        ) : (
          <TreePane
            nodes={tree}
            searching={false}
            renamingId={renamingId}
            dropTarget={dropTarget}
            actions={treeActions}
          />
        )}
      </SidebarGroup>
      {customizingId && journal.itemsById.has(customizingId) && (
        <CustomizeDialog
          key={customizingId}
          item={journal.itemsById.get(customizingId)!}
          onClose={() => setCustomizingId(null)}
        />
      )}
    </SidebarContent>
  );
}
