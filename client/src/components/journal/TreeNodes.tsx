import TreeItemMenu, {
  type TreeItemMenuActions,
} from "@/components/journal/TreeItemMenu";
import { CONTEXT_PARTS, DROPDOWN_PARTS } from "@/components/journal/menuParts";
import RenameInput from "@/components/journal/RenameInput";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import IconButton from "@/components/ui/icon-button";
import { isFolderOpen } from "@/lib/journal/item";
import { focusRow } from "@/lib/journal/focus";
import { cn } from "@/lib/utils";
import type { JournalItem, JournalTreeNode } from "@/types/Journal";
import { EllipsisVertical, FileText, Folder, FolderOpen } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

export type TreeActions = TreeItemMenuActions & {
  dragProps: (item: JournalItem) => React.HTMLAttributes<HTMLElement>;
  onRenamed: (item: JournalItem, name?: string) => void;
  onOpen: (item: JournalItem, newTab: boolean) => void;
  onToggle: (item: JournalItem) => void;
};

type TreeView = {
  searching: boolean;
  renamingId: string | null;
  dropTarget: string | null | undefined;
  coarse: boolean;
  activeId: string | null | undefined;
  expanded: ReadonlySet<string>;
  tabStopId: string;
  actions: TreeActions;
  onFocusRow: (id: string) => void;
  onKeyDown: React.KeyboardEventHandler<HTMLElement>;
};

const TreeRow = memo(function TreeRow({
  node: { item, children },
  depth,
  view,
}: {
  node: JournalTreeNode;
  depth: number;
  view: TreeView;
}) {
  const { t } = useTranslation();
  const { searching, renamingId, dropTarget, coarse, actions } = view;
  const isFolder = item.type === "folder";
  const open = isFolderOpen(item, view.expanded, searching);
  const active = item.id === view.activeId;
  const FolderIcon = open ? FolderOpen : Folder;
  const Icon = isFolder ? FolderIcon : FileText;
  const refocus = (e: Event) => {
    e.preventDefault();
    focusRow(item.id);
  };

  const row =
    renamingId === item.id ? (
      <div
        className="min-w-0 flex-1"
        style={{ paddingInlineStart: `${depth * 12}px` }}
      >
        <RenameInput
          name={item.name}
          onDone={(name) => actions.onRenamed(item, name)}
        />
      </div>
    ) : (
      <button
        type="button"
        role="treeitem"
        data-item-id={item.id}
        aria-level={depth + 1}
        aria-expanded={isFolder ? open : undefined}
        aria-selected={active}
        tabIndex={item.id === view.tabStopId ? 0 : -1}
        {...actions.dragProps(item)}
        className={cn(
          "hover:bg-sidebar-accent flex w-full min-w-0 select-none items-center [-webkit-touch-callout:none] gap-2 rounded-md py-1.5 pe-2 text-start text-sm",
          active && "bg-sidebar-accent",
          dropTarget === item.id && "ring-primary ring-1",
        )}
        style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
        onFocus={() => view.onFocusRow(item.id)}
        onClick={(e) =>
          isFolder
            ? actions.onToggle(item)
            : actions.onOpen(item, e.ctrlKey || e.metaKey)
        }
        onContextMenu={(e) => coarse && e.preventDefault()}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onAuxClick={(e) =>
          e.button === 1 && !isFolder && actions.onOpen(item, true)
        }
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{item.name}</span>
      </button>
    );

  return (
    <li role="none" className="relative">
      {coarse ? (
        <div className="flex items-center">
          {row}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={t("journal.more")}
                size="icon-sm"
                className="shrink-0"
              >
                <EllipsisVertical />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent onCloseAutoFocus={refocus}>
              <TreeItemMenu
                item={item}
                parts={DROPDOWN_PARTS}
                actions={actions}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent onCloseAutoFocus={refocus}>
            <TreeItemMenu item={item} parts={CONTEXT_PARTS} actions={actions} />
          </ContextMenuContent>
        </ContextMenu>
      )}
      {open && children.length > 0 && (
        <TreeNodes nodes={children} depth={depth + 1} view={view} />
      )}
    </li>
  );
});

export function TreeNodes({
  nodes,
  depth,
  view,
}: {
  nodes: JournalTreeNode[];
  depth: number;
  view: TreeView;
}) {
  const { t } = useTranslation();

  return (
    <ul
      role={depth === 0 ? "tree" : "group"}
      aria-label={depth === 0 ? t("journal.notes") : undefined}
      onKeyDown={depth === 0 ? view.onKeyDown : undefined}
    >
      {nodes.map((node) => (
        <TreeRow key={node.item.id} node={node} depth={depth} view={view} />
      ))}
    </ul>
  );
}
