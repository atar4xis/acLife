import { DROPDOWN_PARTS } from "@/components/journal/menuParts";
import JournalTab from "@/components/journal/JournalTab";
import TabMenu from "@/components/journal/TabMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import IconButton from "@/components/ui/icon-button";
import { useJournal } from "@/context/JournalContext";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import { isNewTab, panesOf } from "@/lib/journal/layout";
import type { PaneNode } from "@/types/Journal";
import { BookOpen, EllipsisVertical, Pencil, Plus } from "lucide-react";
import { memo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export default memo(function JournalTabs({ pane }: { pane: PaneNode }) {
  const { t } = useTranslation();
  const journal = useJournal();
  const list = useRef<HTMLUListElement>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const reading = !!pane.reading;

  const panes = panesOf(journal.workspace.layout);
  const coarse = useCoarsePointer();

  const indexAt = (x: number) => {
    const tabs = Array.from(list.current!.children);
    const index = tabs.findIndex((tab) => {
      const rect = tab.getBoundingClientRect();
      return x < rect.left + rect.width / 2;
    });
    return index === -1 ? tabs.length : index;
  };

  return (
    <div
      className="flex min-h-11 items-center gap-1 border-b p-1.5"
      onDragOver={(e) => {
        if (!journal.acceptedDrag) return;
        e.preventDefault();
        setInsertAt(indexAt(e.clientX));
      }}
      onDragLeave={() => setInsertAt(null)}
      onDrop={(e) => {
        if (!journal.acceptedDrag) return;
        e.preventDefault();
        setInsertAt(null);
        journal.dropOnTabs(pane.id, indexAt(e.clientX));
      }}
    >
      {panes.length > 1 && (
        <span className="text-muted-foreground shrink-0 ps-1.5 pe-2 text-sm tabular-nums">
          {panes.findIndex(({ id }) => id === pane.id) + 1}
        </span>
      )}
      <ul
        ref={list}
        role="tablist"
        aria-label={t("journal.tabs")}
        className="flex min-w-0 gap-1 overflow-x-auto"
      >
        {pane.tabs.map((id, index) => {
          const note = journal.itemsById.get(id);
          if (!note && !isNewTab(id)) return null;

          return (
            <JournalTab
              key={id}
              pane={pane}
              id={id}
              name={note?.name ?? t("journal.newTab")}
              insertBefore={insertAt === index}
              insertAfter={
                insertAt === pane.tabs.length && index === pane.tabs.length - 1
              }
            />
          );
        })}
      </ul>
      <IconButton
        label={t("journal.newTab")}
        size="icon-sm"
        data-new-tab
        onClick={() => journal.addTab(pane.id)}
      >
        <Plus />
      </IconButton>
      {coarse && pane.active && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label={t("journal.tabMenu")}
              size="icon-sm"
              className="shrink-0"
            >
              <EllipsisVertical />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <TabMenu
              paneId={pane.id}
              id={pane.active}
              name={
                journal.itemsById.get(pane.active)?.name ?? t("journal.newTab")
              }
              parts={DROPDOWN_PARTS}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {pane.active && !isNewTab(pane.active) && (
        <IconButton
          label={t(reading ? "journal.editMode" : "journal.readingMode")}
          size="icon-sm"
          className="ms-auto shrink-0"
          onClick={() => journal.setReading(pane.id, !reading)}
        >
          {reading ? <Pencil /> : <BookOpen />}
        </IconButton>
      )}
    </div>
  );
});
