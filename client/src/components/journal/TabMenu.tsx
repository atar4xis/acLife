import type { MenuParts } from "@/components/journal/menuParts";
import SplitMenu from "@/components/journal/SplitMenu";
import { useJournal } from "@/context/JournalContext";
import { moveOptions } from "@/lib/journal/layout";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function TabMenu({
  paneId,
  id,
  name,
  parts: { Label, Item },
}: {
  paneId: string;
  id: string;
  name: string;
  parts: MenuParts;
}) {
  const { t } = useTranslation();
  const { workspace, closeTab } = useJournal();
  const drag = { id, fromPane: paneId };

  return (
    <>
      <Label className="max-w-64 truncate">{name}</Label>
      <SplitMenu
        drag={drag}
        anchorPane={paneId}
        options={moveOptions(workspace, drag, paneId)}
        Item={Item}
      />
      <Item onSelect={() => closeTab(paneId, id)}>
        <X />
        {t("journal.closeTab", { name })}
      </Item>
    </>
  );
}
