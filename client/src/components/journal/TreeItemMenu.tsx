import FolderTargetLabel from "@/components/journal/FolderTargetLabel";
import type { MenuParts } from "@/components/journal/menuParts";
import SplitMenu from "@/components/journal/SplitMenu";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { useJournal } from "@/context/JournalContext";
import { useShares } from "@/context/ShareContext";
import { moveOptions } from "@/lib/journal/layout";
import { moveTargets } from "@/lib/journal/item";
import {
  canCreateIn,
  canDeleteItem,
  canEditItem,
  isOwnItem,
} from "@/lib/journal/shared";
import type { JournalItem } from "@/types/Journal";
import {
  Clipboard,
  Columns2,
  FilePlus,
  FolderInput,
  FolderPlus,
  Palette,
  Share2,
  PencilLine,
  Trash2,
} from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

export type TreeItemMenuActions = {
  onRename: (id: string) => void;
  onCreate: (type: JournalItem["type"], parentId: string | null) => void;
  onCustomize: (item: JournalItem) => void;
  onDelete: (item: JournalItem) => void;
  onMove: (item: JournalItem, parentId: string | null) => void;
};

export default function TreeItemMenu({
  item,
  parts: { Label, Separator, Item, Sub, SubTrigger, SubContent },
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

  const sections = [
    item.type === "folder" && canCreateIn(item) && (
      <>
        <Item onSelect={() => actions.onCreate("note", item.id)}>
          <FilePlus />
          {t("journal.newNote")}
        </Item>
        <Item onSelect={() => actions.onCreate("folder", item.id)}>
          <FolderPlus />
          {t("journal.newFolder")}
        </Item>
      </>
    ),
    canEditItem(item) && (
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
    ),
    (canShare && isOwnItem(item)) || developerMode ? (
      <>
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
      </>
    ) : null,
    targets.length > 0 || canSplit ? (
      <>
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
      </>
    ) : null,
    canDeleteItem(item) && (
      <Item onSelect={() => actions.onDelete(item)}>
        <Trash2 />
        {t("journal.delete")}
      </Item>
    ),
  ].filter(Boolean);

  return (
    <>
      <Label className="max-w-64 truncate">{item.name}</Label>
      {sections.map((section, index) => (
        <Fragment key={index}>
          {index > 0 && <Separator />}
          {section}
        </Fragment>
      ))}
    </>
  );
}
