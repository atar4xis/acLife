import type { CalendarEvent } from "@/types/calendar/Event";
import { repeatLabel } from "@/lib/calendar/repeatOptions";
import { describeEvent } from "@/lib/calendar/a11y";
import useAnchoredPosition from "@/hooks/useAnchoredPosition";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  AlignLeftIcon,
  BellIcon,
  ClockIcon,
  PencilIcon,
  RepeatIcon,
  XIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import {
  EVENT_COLOR_FALLBACK,
  useCalendarSettings,
} from "@/context/CalendarSettingsContext";
import { cn } from "@/lib/utils";
import { fmt } from "@/i18n";
import { useTranslation } from "react-i18next";

export default function EventDetails({
  event,
  blockRef,
  timeLabel,
  onToggleCompleted,
  onEdit,
  onCancel,
}: {
  event: CalendarEvent;
  blockRef: RefObject<HTMLDivElement | null>;
  timeLabel: string;
  onToggleCompleted: (completed: boolean) => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const detailsRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const completedId = useId();
  const { pos, startDrag, isMobile } = useAnchoredPosition(
    detailsRef,
    blockRef,
    true,
  );
  const settings = useCalendarSettings((s) => ({
    opacity: s.eventEditorOpacity,
    blur: s.eventEditorBlur,
    radius: s.eventEditorRadius,
  }));

  const [announcement, setAnnouncement] = useState(""); // for screen readers
  useEffect(() => {
    setAnnouncement(
      [
        t(event.isTask ? "details.taskTitle" : "details.title"),
        describeEvent(event, false),
        event.repeat && repeatLabel(event.repeat, event.start),
        event.description,
      ]
        .filter(Boolean)
        .join(". "),
    );
  }, [event, t]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as Element;
      if (!detailsRef.current?.contains(el) && !blockRef.current?.contains(el))
        onCancel();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
    };
  }, [onCancel, blockRef]);

  return createPortal(
    <div
      className="pointer-events-auto event-editor fixed z-20 left-0 top-0 flex flex-col justify-center md:justify-start p-3 px-5 md:px-3 shadow-lg border md:rounded-(--editor-radius) w-full h-full md:w-auto md:h-auto md:max-h-240"
      style={
        {
          top: pos.top,
          left: pos.left,
          backgroundColor: `color-mix(in srgb, var(--card) ${settings.opacity}%, transparent)`,
          backdropFilter: `blur(${settings.blur}px)`,
          "--editor-radius": `${settings.radius}px`,
        } as React.CSSProperties
      }
      ref={detailsRef}
      role="dialog"
      aria-labelledby={titleId}
    >
      <div role="status" className="sr-only">
        {announcement}
      </div>
      <div
        className={cn(
          "flex justify-between mb-4 items-center shrink-0",
          !isMobile && "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={startDrag}
      >
        <h3 id={titleId} className="text-xl font-semibold select-none">
          {t(event.isTask ? "details.taskTitle" : "details.title")}
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("editor.title")}
            onClick={onEdit}
          >
            <PencilIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("common.close")}
            onClick={onCancel}
          >
            <XIcon />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2 mb-3 min-h-0 overflow-y-auto overflow-x-hidden md:min-w-80 md:max-w-120">
        <div className="flex items-center gap-2 text-sm">
          <span
            className="size-4 shrink-0 rounded-full border"
            style={{ backgroundColor: event.color ?? EVENT_COLOR_FALLBACK }}
          />
          <span dir="auto" className="break-words min-w-0">
            {event.title}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <ClockIcon className="size-4 shrink-0" />
          {event.start.toFormat(fmt("dateShort"))}
          {" · "}
          {event.allDay ? t("editor.allDay") : timeLabel}
        </div>
        {event.repeat && (
          <div className="flex items-center gap-2 text-sm">
            <RepeatIcon className="size-4 shrink-0" />
            {repeatLabel(event.repeat, event.start)}
          </div>
        )}
        {!!event.notifications?.length && (
          <div className="flex items-start gap-2 text-sm">
            <BellIcon className="size-4 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              {event.notifications.map((n, i) => (
                <span key={i}>
                  {n.when === "start"
                    ? t("notify.whenOptions.start")
                    : t(`notify.summary.${n.when}`, { count: n.amount })}
                </span>
              ))}
            </div>
          </div>
        )}
        {event.description && (
          <div className="flex items-start gap-2 text-sm">
            <AlignLeftIcon className="size-4 shrink-0 mt-0.5" />
            <p dir="auto" className="whitespace-pre-wrap break-words min-w-0">
              {event.description}
            </p>
          </div>
        )}

        {event.isTask && (
          <div className="flex items-center gap-2 mt-2 text-sm">
            <Checkbox
              id={completedId}
              checked={!!event.completed}
              onCheckedChange={(c) => onToggleCompleted(!!c)}
            />
            <Label htmlFor={completedId} className="font-normal leading-5">
              {t("editor.completed")}
            </Label>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
