import { isColorDark } from "@/lib/utils";
import type { EventBlockProps } from "@/types/Props";
import { useLayoutEffect, useRef, useState, memo } from "react";
import EventEditor from "./EventEditor";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { Clipboard, Trash2 } from "lucide-react";
import useTapInteraction from "@/hooks/useTapInteraction";

export default memo(function EventBlock({
  event,
  day,
  style,
  onPointerDown,
  onEventEdit,
  onEventDelete,
}: EventBlockProps) {
  const [mini, setMini] = useState(false);
  const [editing, setEditing] = useState(false);
  const [visibleLines, setVisibleLines] = useState(8);

  const eventColor = event.color ?? "#2563eb";
  const textColor = isColorDark(eventColor) ? "text-white" : "text-black";

  const sameMeridiem = event.start.toFormat("a") === event.end.toFormat("a");
  const startTimeFormat =
    (event.start.minute === 0 ? "h" : "h:mm") + (!sameMeridiem ? " a" : "");
  const endTimeFormat = event.end.minute === 0 ? "h a" : "h:mm a";

  const eventRef = useRef<HTMLDivElement>(null);

  // measure needed height using a hidden container
  // TODO: kinda hacky, is there a better way?
  const measureRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (measureRef.current) {
      setMini(style.height <= measureRef.current.offsetHeight);

      const lineHeight = parseFloat(
        window.getComputedStyle(measureRef.current).lineHeight,
      );
      setVisibleLines(Math.ceil(style.height / lineHeight) - 2);
    }
  }, [style.height, event.title, startTimeFormat, endTimeFormat]);

  const copyID = () => {
    navigator.clipboard.writeText(event.parent || event.id);
  };

  const { handlers: tapHandlers } = useTapInteraction({
    onTap: () => setTimeout(() => setEditing(true), 50),
  });

  return (
    <>
      {/* hidden measurement container */}
      <div
        ref={measureRef}
        className="absolute invisible pointer-events-none text-xs"
        style={{ position: "absolute", top: -43110, width: style.width + "%" }}
      >
        <span className="font-semibold">{event.title}</span>
        <span className="text-xs block">
          {event.start.toFormat(startTimeFormat)}
          {" - "}
          {event.end.toFormat(endTimeFormat)}
        </span>
      </div>

      <ContextMenu>
        <ContextMenuTrigger
          onPointerDown={(e) => {
            if (e.pointerType === "touch") e.preventDefault();
          }}
        >
          {/* visible event block */}
          <div
            className={`absolute left-0 right-0 z-10 ${mini ? "p-0" : "p-1"} text-xs ${textColor} cursor-pointer select-none overflow-hidden shadow-[inset_0_0_3px_rgba(0,0,0,0.35)]`}
            style={{
              top: style.top,
              left: style.left + "%",
              height: style.height,
              width: style.width + "%",
              backgroundColor: eventColor,
            }}
            onPointerDown={(e) => {
              if (e.pointerType === "touch") tapHandlers.onPointerDown(e);
              onPointerDown(e, "move", event, day);
            }}
            onPointerUp={tapHandlers.onPointerUp}
            onDoubleClick={() => setEditing(true)}
            ref={eventRef}
          >
            <div
              className="font-semibold"
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: visibleLines,
                overflow: "hidden",
              }}
            >
              {event.title}
            </div>
            <span className="text-xs block">
              {event.start.toFormat(startTimeFormat)}
              {" - "}
              {event.end.toFormat(endTimeFormat)}
            </span>

            {/* handles for resizing */}
            <div
              className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-background/20"
              onPointerDown={(e) =>
                onPointerDown(e, "resize_start", event, day)
              }
            />
            <div
              className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-background/20"
              onPointerDown={(e) => onPointerDown(e, "resize_end", event, day)}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onPointerDown={(e) => e.stopPropagation()}>
          {/* context menu items */}
          <ContextMenuLabel>{event.title}</ContextMenuLabel>

          <ContextMenuItem onClick={copyID}>
            <Clipboard />
            {event.parent ? "Copy parent ID" : "Copy ID"}
          </ContextMenuItem>

          <ContextMenuItem onClick={onEventDelete}>
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
          onDelete={onEventDelete}
          onCancel={() => setEditing(false)}
        />
      )}
    </>
  );
});
