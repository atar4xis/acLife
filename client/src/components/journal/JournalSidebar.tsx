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
import type { JournalItem } from "@/types/Journal";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export default function JournalSidebar() {
  const { t } = useTranslation();
  const journal = useJournal();
  const items = useJournalItems();
  const { isMobile, setOpenMobile } = useSidebar();
  const { dropTarget, dragProps, rootProps } = useTreeDrag();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);

  const searching = query.trim().length > 0;
  const source = searching ? items : journal.items;
  const tree = useMemo(
    () => filterTree(buildTree(source, journal.sort), query),
    [source, journal.sort, query],
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
        {tree.length === 0 ? (
          <p className="text-muted-foreground p-2 text-sm">
            {t(searching ? "journal.noMatches" : "journal.empty")}
          </p>
        ) : (
          <nav aria-label={t("journal.notes")}>
            <JournalTree
              nodes={tree}
              searching={searching}
              renamingId={renamingId}
              dropTarget={dropTarget}
              actions={treeActions}
            />
          </nav>
        )}
      </SidebarGroup>
    </SidebarContent>
  );
}
