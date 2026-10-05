import type { CalendarEvent } from "@/types/calendar/Event";
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "../ui/context-menu";
import {
  Clipboard,
  CopyIcon,
  PencilLine,
  RotateCcw,
  Trash2,
  Unlink,
} from "lucide-react";
import { MoveMenuItems } from "./MoveMenuItems";
import { useTranslation } from "react-i18next";

type EventMenuItemsProps = {
  event: CalendarEvent;
  onEdit: () => void;
  onMove: (originalEvent: CalendarEvent, event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
  onDuplicate: (event: CalendarEvent) => void;
  onDetach: (event: CalendarEvent) => void;
  onReset: (event: CalendarEvent) => void;
};

export function EventMenuItems({
  event,
  onEdit,
  onMove,
  onDelete,
  onDuplicate,
  onDetach,
  onReset,
}: EventMenuItemsProps) {
  const { t } = useTranslation();

  return (
    <>
      <ContextMenuLabel className="max-w-64 truncate">
        {event.title}
      </ContextMenuLabel>

      <ContextMenuItem onClick={onEdit}>
        <PencilLine />
        {t("block.edit")}
      </ContextMenuItem>

      <ContextMenuItem
        onClick={() => navigator.clipboard.writeText(event._parent || event.id)}
      >
        <Clipboard />
        {event._parent ? t("block.copyParentId") : t("block.copyId")}
      </ContextMenuItem>

      <ContextMenuItem onClick={() => onDuplicate(event)}>
        <CopyIcon />
        {t("block.duplicate")}
      </ContextMenuItem>

      {event._parent && (
        <ContextMenuItem onClick={() => onDetach(event)}>
          <Unlink />
          {t("block.detach")}
        </ContextMenuItem>
      )}

      {event._resettable && (
        <ContextMenuItem onClick={() => onReset(event)}>
          <RotateCcw />
          {t("block.reset")}
        </ContextMenuItem>
      )}

      <MoveMenuItems
        event={event}
        onMove={onMove}
        menu={{
          Sub: ContextMenuSub,
          SubTrigger: ContextMenuSubTrigger,
          SubContent: ContextMenuSubContent,
          Item: ContextMenuItem,
          Separator: ContextMenuSeparator,
        }}
      />

      <ContextMenuItem onClick={() => onDelete(event)}>
        <Trash2 /> {t("common.delete")}
      </ContextMenuItem>
    </>
  );
}
