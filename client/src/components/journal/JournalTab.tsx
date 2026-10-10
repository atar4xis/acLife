import { CONTEXT_PARTS } from "@/components/journal/menuParts";
import TabMenu from "@/components/journal/TabMenu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { useJournal } from "@/context/JournalContext";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import {
  focusAfterLastClose,
  focusTab,
  openContextMenu,
} from "@/lib/journal/focus";
import { neighborTab } from "@/lib/journal/layout";
import { touchDrag } from "@/lib/touchDrag";
import { cn } from "@/lib/utils";
import type { PaneNode } from "@/types/Journal";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function JournalTab({
  pane,
  id,
  name,
  insertBefore,
  insertAfter,
}: {
  pane: PaneNode;
  id: string;
  name: string;
  insertBefore: boolean;
  insertAfter: boolean;
}) {
  const { t } = useTranslation();
  const journal = useJournal();
  const coarse = useCoarsePointer();
  const active = id === pane.active;
  const index = pane.tabs.indexOf(id);

  const close = () => {
    const next = neighborTab(pane.tabs, id);
    journal.closeTab(pane.id, id);
    if (next) focusTab(next);
    else focusAfterLastClose();
  };

  const select = (tabId: string) => {
    journal.activateTab(pane.id, tabId);
    focusTab(tabId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const { tabs } = pane;
    if (e.key === "ArrowLeft") {
      select(tabs[(index - 1 + tabs.length) % tabs.length]);
    } else if (e.key === "ArrowRight") {
      select(tabs[(index + 1) % tabs.length]);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      close();
    } else if (
      e.key === "ContextMenu" ||
      (e.key === "F10" && e.shiftKey) ||
      (e.key.toLowerCase() === "m" && !e.shiftKey)
    ) {
      openContextMenu(e.currentTarget.closest("li")!);
    } else {
      return;
    }
    e.preventDefault();
  };

  const tab = (
    <li
      role="presentation"
      draggable
      className={cn(
        "group flex shrink-0 select-none items-center rounded-md border [-webkit-touch-callout:none]",
        active &&
          (journal.workspace.focused === pane.id
            ? "bg-accent"
            : "bg-accent/50"),
        insertBefore && "shadow-[-2px_0_0_0_var(--primary)]",
        insertAfter && "shadow-[2px_0_0_0_var(--primary)]",
      )}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", name);
        journal.startDrag({ id, fromPane: pane.id });
      }}
      onDragEnd={journal.endDrag}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => e.button === 1 && journal.closeTab(pane.id, id)}
      onContextMenu={(e) => coarse && e.preventDefault()}
      onPointerDown={touchDrag({
        label: name,
        onStart: () => journal.startDrag({ id, fromPane: pane.id }),
        onEnd: journal.endDrag,
      })}
    >
      <button
        type="button"
        role="tab"
        data-tab-id={id}
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        className="max-w-48 truncate py-1 ps-3 pe-1 text-sm"
        onClick={() => journal.activateTab(pane.id, id)}
        onKeyDown={onKeyDown}
      >
        {name}
      </button>
      <Button
        type="button"
        variant="ghost"
        aria-hidden
        tabIndex={-1}
        aria-label={t("journal.closeTab", { name })}
        size="icon-sm"
        className="pointer-coarse:opacity-80 me-1 size-5 opacity-0 group-hover:opacity-80 hover:group-hover:opacity-100 focus-visible:opacity-100"
        onClick={close}
      >
        <X className="size-3.5" />
      </Button>
    </li>
  );

  if (coarse) return tab;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tab}</ContextMenuTrigger>
      <ContextMenuContent>
        <TabMenu paneId={pane.id} id={id} name={name} parts={CONTEXT_PARTS} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
