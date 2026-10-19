import FolderTargetLabel from "@/components/journal/FolderTargetLabel";
import type { MenuParts } from "@/components/journal/menuParts";
import SplitMenu from "@/components/journal/SplitMenu";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { useJournal } from "@/context/JournalContext";
import { useShares } from "@/context/ShareContext";
import { moveOptions } from "@/lib/journal/layout";
import { moveTargets } from "@/lib/journal/item";
import { canDeleteItem, canEditItem, isOwnItem } from "@/lib/journal/shared";
import type { JournalItem } from "@/types/Journal";
import {
  Clipboard,
  Columns2,
  FolderInput,
  Palette,
  Share2,
  PencilLine,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

export type TreeItemMenuActions = {
  onRename: (id: string) => void;
  onCustomize: (item: JournalItem) => void;
  onDelete: (item: JournalItem) => void;
  onMove: (item: JournalItem, parentId: string | null) => void;
};

export default function TreeItemMenu({
  item,
  parts: { Label, Item, Sub, SubTrigger, SubContent },
  actions,
}: {
  item: JournalItem;
  parts: MenuParts;
  actions: TreeItemMenuActions;
}) {
  const { t } = useTranslation();
  const developerMode = useCalendarSettings((s) => s.developerMode);
  const { items, sort, workspace, expanded } = useJournal();
  const { enabled: canShare, openShare } = useShares();
  const targets = moveTargets(items, sort, item);
  const drag = { id: item.id };
  const options = moveOptions(workspace, drag, workspace.focused);
  const canSplit =
    item.type === "note" && options.zones.length + options.panes.length > 0;

  return (
    <>
      <Label className="max-w-64 truncate">{item.name}</Label>
      {canEditItem(item) && (
        <>
          <Item onSelect={() => actions.onRename(item.id)}>
            <PencilLine />
            {t("journal.rename")}
          </Item>
          <Item onSelect={() => actions.onCustomize(item)}>
            <Palette />
            {t("journal.customize")}
          </Item>
        </>
      )}
      {canShare && isOwnItem(item) && (
        <Item
          onSelect={() =>
            openShare({
              kind: "journal",
              scope: item.type === "folder" ? "collection" : "item",
              target: item.id,
              label: item.name,
            })
          }
        >
          <Share2 />
          {t("shares.share")}
        </Item>
      )}
      {developerMode && (
        <Item onSelect={() => navigator.clipboard.writeText(item.id)}>
          <Clipboard />
          {t("block.copyId")}
        </Item>
      )}
      {targets.length > 0 && (
        <Sub>
          <SubTrigger>
            <FolderInput />
            {t("journal.moveTo")}
          </SubTrigger>
          <SubContent>
            {targets.map(({ folder, depth }) => (
              <Item
                key={folder?.id ?? "root"}
                style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
                onSelect={() => actions.onMove(item, folder?.id ?? null)}
              >
                <FolderTargetLabel
                  folder={folder}
                  open={folder ? expanded.has(folder.id) : false}
                />
              </Item>
            ))}
          </SubContent>
        </Sub>
      )}
      {canSplit && (
        <Sub>
          <SubTrigger>
            <Columns2 />
            {t("journal.openInSplit")}
          </SubTrigger>
          <SubContent>
            <SplitMenu
              drag={drag}
              anchorPane={workspace.focused}
              options={options}
              Item={Item}
            />
          </SubContent>
        </Sub>
      )}
      {canDeleteItem(item) && (
        <Item onSelect={() => actions.onDelete(item)}>
          <Trash2 />
          {t("journal.delete")}
        </Item>
      )}
    </>
  );
}
