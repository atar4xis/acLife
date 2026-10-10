import type { MenuParts } from "@/components/journal/menuParts";
import { useJournal } from "@/context/JournalContext";
import { focusTab } from "@/lib/journal/focus";
import type { moveOptions } from "@/lib/journal/layout";
import type { DropZone, JournalDrag } from "@/types/Journal";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  PanelsTopLeft,
} from "lucide-react";
import { useTranslation } from "react-i18next";

const ZONE_ICONS = {
  left: ArrowLeftToLine,
  right: ArrowRightToLine,
  top: ArrowUpToLine,
  bottom: ArrowDownToLine,
};

export default function SplitMenu({
  drag,
  anchorPane,
  options: { zones, panes },
  Item,
}: {
  drag: JournalDrag;
  anchorPane: string;
  options: ReturnType<typeof moveOptions>;
  Item: MenuParts["Item"];
}) {
  const { t } = useTranslation();
  const { dropOnPane } = useJournal();

  const move = (paneId: string, zone: DropZone) => {
    dropOnPane(paneId, zone, drag);
    focusTab(drag.id);
  };

  return (
    <>
      {zones.map((zone) => {
        const Icon = ZONE_ICONS[zone];
        return (
          <Item key={zone} onSelect={() => move(anchorPane, zone)}>
            <Icon />
            {t(`journal.split.${zone}`)}
          </Item>
        );
      })}
      {panes.map(({ id, number }) => (
        <Item key={id} onSelect={() => move(id, "center")}>
          <PanelsTopLeft />
          {t("journal.movePane", { n: number })}
        </Item>
      ))}
    </>
  );
}
