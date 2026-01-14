import type { CalendarEvent } from "@/types/calendar/Event";
import type { EventBlockProps } from "@/types/Props";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Field, FieldLabel } from "../ui/field";
import { Textarea } from "../ui/textarea";
import { ColorPicker } from "../ui/color-picker";
import { clamp } from "@/lib/utils";
import { DateTimePicker } from "./DateTimePicker";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { Trash2Icon, XIcon } from "lucide-react";

export default function EventEditor({
  event,
  eventRef,
  onSave,
  onDelete,
  onCancel,
}: Partial<EventBlockProps> & {
  eventRef: RefObject<HTMLDivElement | null>;
  onSave: (event: CalendarEvent) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  if (!event) throw new Error("invalid instance of EventEditor");

  const originalEvent = useRef(event);
  const editorRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [color, setColor] = useState(event.color || "#2563eb");
  const [start, setStart] = useState<Date | undefined>(event.start.toJSDate());
  const [end, setEnd] = useState<Date | undefined>(event.end.toJSDate());
  const isMobile = useIsMobile();

  const presetColors = [
    "#2563eb",
    "#8125ea",
    "#ea25d6",
    "#ea2528",
    "#ea7a25",
    "#eae425",
    "#2fea25",
    "#e5e5e5",
    "#141414",
  ];

  const handleSave = () => {
    const newEvent = {
      ...originalEvent.current,
      title,
      description,
      color,
      start: DateTime.fromJSDate(start || new Date()),
      end: DateTime.fromJSDate(end || new Date()),
      timestamp: Date.now(),
    } as CalendarEvent;

    // make sure dates are valid
    if (newEvent.start > newEvent.end) {
      toast.warning("An event cannot end before it starts.", {
        cancel: {
          label: "OK",
          onClick: () => {},
        },
      });
      return;
    }

    onSave(newEvent);
  };

  useLayoutEffect(() => {
    const rect = eventRef.current?.getBoundingClientRect();
    const myRect = editorRef.current?.getBoundingClientRect();

    if (!rect || !myRect) return;

    const newTop = isMobile ? 0 : rect.top - myRect.height * 0.25;
    const newLeft = isMobile
      ? window.innerWidth / 2 - myRect.width / 2
      : rect.left + rect.width / 2 - myRect.width / 2;

    setPos({
      top: clamp(newTop, 0, window.innerHeight - myRect.height),
      left: clamp(newLeft, 0, window.innerWidth - myRect.width),
    });
  }, [isMobile, eventRef]);

  return (
    <div
      className="fixed z-20 left-0 top-0 flex flex-col justify-center md:block bg-card/98 backdrop-blur p-3 px-5 md:px-3 shadow-lg border md:rounded-lg w-full h-full md:w-auto md:h-auto"
      style={{
        top: pos.top,
        left: pos.left,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      ref={editorRef}
    >
      <div className="flex justify-between mb-5 items-center">
        <h3 className="text-xl font-semibold">Edit Event</h3>
        <Button variant="ghost" size="icon" onClick={onCancel}>
          <XIcon />
        </Button>
      </div>
      <div className="flex flex-col gap-5 my-3">
        <Field>
          <FieldLabel>Title &amp; Color</FieldLabel>
          <div className="flex">
            <Input
              type="text"
              className="mr-2"
              placeholder={originalEvent.current.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <ColorPicker
              presetColors={presetColors}
              onChange={(v) => {
                setColor(v as string);
              }}
              value={color}
            />
          </div>
        </Field>

        <Field>
          <FieldLabel>Start &amp; End Time</FieldLabel>
          <DateTimePicker value={start} onChange={setStart} />
          <DateTimePicker value={end} onChange={setEnd} />
        </Field>

        <Field>
          <FieldLabel>Description</FieldLabel>
          <Textarea
            placeholder={originalEvent.current.description}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end justify-between mt-5">
        <Button size="icon" variant="secondary" onClick={onDelete}>
          <Trash2Icon />
        </Button>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </div>
    </div>
  );
}
