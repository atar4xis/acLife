import { isColorDark, shallowEqual } from "@/lib/utils";
import type { EventBlockProps } from "@/types/Props";
import { useRef, useState, memo, useMemo, useCallback } from "react";
import EventEditor from "./EventEditor";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { Clipboard, PencilLine, Trash2 } from "lucide-react";
import useTapInteraction from "@/hooks/useTapInteraction";

export default memo(
  function EventBlock({
    event,
    day,
    style,
    onPointerDown,
    onEventEdit,
    onEventDelete,
  }: EventBlockProps) {
    const [editing, setEditing] = useState(false);

    const { eventColor, textColor, startTimeFormat, endTimeFormat } =
      useMemo(() => {
        const color = event.color ?? "#2563eb";
        const isDark = isColorDark(color);
        const sameMeridiem =
          event.start.toFormat("a") === event.end.toFormat("a");
        return {
          eventColor: color,
          textColor: isDark ? "text-white" : "text-black",
          startTimeFormat:
            (event.start.minute === 0 ? "h" : "h:mm") +
            (!sameMeridiem ? " a" : ""),
          endTimeFormat: event.end.minute === 0 ? "h a" : "h:mm a",
        };
      }, [event.start, event.end, event.color]);

    const blockStyle = useMemo(
      () => ({
        top: style.top,
        left: style.left + "%",
        height: style.height,
        width: style.width + "%",
        backgroundColor: eventColor,
      }),
      [style.top, style.left, style.height, style.width, eventColor],
    );

    const eventRef = useRef<HTMLDivElement>(null);
    const lineHeight = 16;
    const lineClamp = useMemo(
      () => Math.ceil(style.height / lineHeight) - 2,
      [style.height],
    );
    const timeLabel = useMemo(
      () =>
        `${event.start.toFormat(startTimeFormat)} - ${event.end.toFormat(endTimeFormat)}`,
      [event.start, event.end, startTimeFormat, endTimeFormat],
    );

    const copyID = useCallback(() => {
      navigator.clipboard.writeText(event.parent || event.id);
    }, [event.id, event.parent]);

    const { handlers: tapHandlers } = useTapInteraction({
      onTap: () => setTimeout(() => setEditing(true), 50),
    });

    const handleDelete = useCallback(() => {
      onEventDelete(event);
    }, [onEventDelete, event]);

    const preventTouch = useCallback((e: React.PointerEvent) => {
      if (e.pointerType === "touch") e.preventDefault();
    }, []);

    const stopPropagation = useCallback((e: React.PointerEvent) => {
      e.stopPropagation();
    }, []);

    return (
      <>
        <ContextMenu>
          <ContextMenuTrigger onPointerDown={preventTouch}>
            {/* visible event block */}
            <div
              className={`absolute rounded left-0 right-0 z-10 text-xs ${textColor} cursor-pointer select-none overflow-hidden shadow-[inset_0_0_3px_rgba(0,0,0,0.35)]`}
              style={blockStyle}
              onPointerDown={useCallback(
                (e: React.PointerEvent) => {
                  if (e.pointerType === "touch") tapHandlers.onPointerDown(e);
                  onPointerDown(e, "move", event, day);
                },
                [tapHandlers, day, event, onPointerDown],
              )}
              onPointerUp={tapHandlers.onPointerUp}
              onDoubleClick={() => setEditing(true)}
              ref={eventRef}
            >
              <div
                className="font-semibold"
                style={{
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: lineClamp,
                  overflow: "hidden",
                }}
              >
                {event.title}
              </div>
              <span className="text-xs block">{timeLabel}</span>

              {/* handles for resizing */}
              <div
                className="hidden md:block absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-background/20"
                onPointerDown={(e) =>
                  onPointerDown(e, "resize_start", event, day)
                }
              />
              <div
                className="hidden md:block absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-background/20"
                onPointerDown={(e) =>
                  onPointerDown(e, "resize_end", event, day)
                }
              />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent onPointerDown={stopPropagation}>
            {/* context menu items */}
            <ContextMenuLabel>{event.title}</ContextMenuLabel>

            <ContextMenuItem onClick={() => setEditing(true)}>
              <PencilLine />
              Edit
            </ContextMenuItem>

            <ContextMenuItem onClick={copyID}>
              <Clipboard />
              {event.parent ? "Copy parent ID" : "Copy ID"}
            </ContextMenuItem>

            <ContextMenuItem onClick={handleDelete}>
              <Trash2 /> Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {/* edit overlay */}
        {editing && (
          <EventEditor
            event={event}
            eventRef={eventRef}
            onSave={(newEvent) => {
              onEventEdit(newEvent);
              setEditing(false);
            }}
            onDelete={handleDelete}
            onCancel={() => setEditing(false)}
          />
        )}
      </>
    );
  },
  (prev, next) => {
    return (
      prev.event === next.event &&
      prev.day === next.day &&
      shallowEqual(prev.style, next.style)
    );
  },
);
