import ItemIcon from "@/components/journal/ItemIcon";
import type { JournalItem } from "@/types/Journal";
import { FolderTree } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function FolderTargetLabel({
  folder,
  open,
}: {
  folder: JournalItem | null;
  open?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      {folder ? <ItemIcon item={folder} open={open} /> : <FolderTree />}
      {folder?.name ?? t("journal.root")}
    </>
  );
}
