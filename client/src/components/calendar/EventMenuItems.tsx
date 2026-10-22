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
  ClipboardPaste,
  Files,
  CopyIcon,
  PencilLine,
  RotateCcw,
  Share2,
  Trash2,
  Unlink,
} from "lucide-react";
import { MoveMenuItems } from "./MoveMenuItems";
import { useTranslation } from "react-i18next";
import { useCalendarActions } from "@/context/CalendarContext";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { useShares } from "@/context/ShareContext";
import { canDeleteEvent, canEditEvent } from "@/lib/calendar/shared";

type EventMenuItemsProps = {
  event: CalendarEvent;
  onEdit: () => void;
  onMove: (originalEvent: CalendarEvent, event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
  onDuplicate: (event: CalendarEvent) => void;
  onDetach: (event: CalendarEvent) => void;
  onShareOccurrence: (event: CalendarEvent) => string;
  onReset: (event: CalendarEvent) => void;
  pasteable?: boolean;
};

export function PasteMenuItem() {
  const { t } = useTranslation();
  const { paste, canPaste } = useCalendarActions().eventHandlers;

  return (
    <ContextMenuItem disabled={!canPaste()} onClick={paste}>
      <ClipboardPaste />
      {t("common.paste")}
    </ContextMenuItem>
  );
}

export function EventMenuItems({
  event,
  onEdit,
  onMove,
  onDelete,
  onDuplicate,
  onDetach,
  onShareOccurrence,
  onReset,
  pasteable,
}: EventMenuItemsProps) {
  const { t } = useTranslation();
  const { copy } = useCalendarActions().eventHandlers;
  const developerMode = useCalendarSettings((s) => s.developerMode);
  const editable = canEditEvent(event);
  const { enabled: canShare, openShare } = useShares();
  const shareable = canShare && !event._shared;
  const recurring = !!event._parent || !!event.repeat;

  return (
    <>
      <ContextMenuLabel className="max-w-64 truncate">
        {event.title}
      </ContextMenuLabel>

      {editable && (
        <ContextMenuItem onClick={onEdit}>
          <PencilLine />
          {t("block.edit")}
        </ContextMenuItem>
      )}

      {shareable && recurring && (
        <ContextMenuItem
          onClick={() =>
            openShare({
              kind: "calendar",
              scope: "item",
              target: () => onShareOccurrence(event),
              label: event.title,
            })
          }
        >
          <Share2 />
          {t("shares.shareOccurrence")}
        </ContextMenuItem>
      )}

      {shareable && (
        <ContextMenuItem
          onClick={() =>
            openShare({
              kind: "calendar",
              scope: "item",
              target: event.id,
              label: event.title,
            })
          }
        >
          <Share2 />
          {t(recurring ? "shares.shareSeries" : "shares.share")}
        </ContextMenuItem>
      )}

      {developerMode && (
        <ContextMenuItem
          onClick={() =>
            navigator.clipboard.writeText(event._parent || event.id)
          }
        >
          <Clipboard />
          {event._parent ? t("block.copyParentId") : t("block.copyId")}
        </ContextMenuItem>
      )}

      <ContextMenuItem onClick={() => copy(event)}>
        <Files />
        {t("common.copy")}
      </ContextMenuItem>

      {pasteable && <PasteMenuItem />}

      <ContextMenuItem onClick={() => onDuplicate(event)}>
        <CopyIcon />
        {t("block.duplicate")}
      </ContextMenuItem>

      {canDeleteEvent(event) && event._parent && (
        <ContextMenuItem onClick={() => onDetach(event)}>
          <Unlink />
          {t("block.detach")}
        </ContextMenuItem>
      )}

      {editable && event._resettable && (
        <ContextMenuItem onClick={() => onReset(event)}>
          <RotateCcw />
          {t("block.reset")}
        </ContextMenuItem>
      )}

      {editable && (
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
      )}

      {canDeleteEvent(event) && (
        <ContextMenuItem onClick={() => onDelete(event)}>
          <Trash2 /> {t("common.delete")}
        </ContextMenuItem>
      )}
    </>
  );
}
