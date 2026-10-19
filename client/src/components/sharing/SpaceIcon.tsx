import ItemIcon from "@/components/journal/ItemIcon";
import type { JournalItem } from "@/types/Journal";
import type { SpaceKind, SpaceScope } from "@/types/Share";
import {
  BookText,
  CalendarClock,
  CalendarDays,
  FileText,
  Folder,
} from "lucide-react";

const className = "text-muted-foreground size-4 shrink-0";

export default function SpaceIcon({
  kind,
  scope,
  whole,
  item,
}: {
  kind: SpaceKind;
  scope: SpaceScope;
  whole?: boolean;
  item?: JournalItem;
}) {
  if (kind === "calendar") {
    const Icon = scope === "collection" ? CalendarDays : CalendarClock;
    return <Icon className={className} />;
  }
  if (whole) return <BookText className={className} />;
  if (item) return <ItemIcon item={item} className={className} />;

  const Icon = scope === "collection" ? Folder : FileText;
  return <Icon className={className} />;
}
