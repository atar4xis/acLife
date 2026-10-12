import { LucideIcon } from "@/components/ui/lucide-icon";
import { itemIconName } from "@/lib/journal/item";
import type { JournalItem } from "@/types/Journal";

export default function ItemIcon({
  item,
  open = false,
  className,
}: {
  item: JournalItem;
  open?: boolean;
  className?: string;
}) {
  return (
    <LucideIcon
      name={itemIconName(item, open)}
      className={className}
      style={item.colorIcon ? { color: item.color } : undefined}
    />
  );
}
