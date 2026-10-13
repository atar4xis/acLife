import type { MenuParts } from "@/components/journal/menuParts";
import SplitMenu from "@/components/journal/SplitMenu";
import { useJournal } from "@/context/JournalContext";
import { moveOptions, panesOf } from "@/lib/journal/layout";
import { ArrowDownToLine, ArrowRightToLine, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function TabMenu({
  paneId,
  id,
  name,
  parts: { Label, Item, Separator },
}: {
  paneId: string;
  id: string;
  name: string;
  parts: MenuParts;
}) {
  const { t } = useTranslation();
  const { workspace, closeTab, closeTabs, splitTab } = useJournal();
  const drag = { id, fromPane: paneId };
  const options = moveOptions(workspace, drag, paneId);

  const { tabs } = panesOf(workspace.layout).find((p) => p.id === paneId)!;
  const index = tabs.indexOf(id);
  const closeActions = [
    { key: "closeOthers", ids: tabs.filter((tab) => tab !== id) },
    { key: "closeLeft", ids: tabs.slice(0, index) },
    { key: "closeRight", ids: tabs.slice(index + 1) },
  ].filter(({ ids }) => ids.length > 0);

  return (
    <>
      <Label className="max-w-64 truncate">{name}</Label>
      <Item onSelect={() => closeTab(paneId, id)}>
        <X />
        {t("common.close")}
      </Item>
      {closeActions.map(({ key, ids }) => (
        <Item key={key} onSelect={() => closeTabs(ids)}>
          <X />
          {t(`journal.${key}`)}
        </Item>
      ))}
      <Separator />
      <Item onSelect={() => splitTab(paneId, id, "right")}>
        <ArrowRightToLine />
        {t("journal.splitRight")}
      </Item>
      <Item onSelect={() => splitTab(paneId, id, "bottom")}>
        <ArrowDownToLine />
        {t("journal.splitDown")}
      </Item>
      {(options.zones.length > 0 || options.panes.length > 0) && (
        <>
          <Separator />
          <SplitMenu
            drag={drag}
            anchorPane={paneId}
            options={options}
            Item={Item}
          />
        </>
      )}
    </>
  );
}
