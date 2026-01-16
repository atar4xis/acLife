import type { CalendarEvent } from "@/types/calendar/Event";
import type { EventBlockProps } from "@/types/Props";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
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

  const newEvent = useRef<CalendarEvent>({
    ...originalEvent.current,
    title,
    description,
    color,
    start: DateTime.fromJSDate(start || new Date()),
    end: DateTime.fromJSDate(end || new Date()),
    timestamp: Date.now(),
  });

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
    // make sure dates are valid
    if (newEvent.current.start > newEvent.current.end) {
      toast.warning("An event cannot end before it starts.", {
        cancel: {
          label: "OK",
          onClick: () => {},
        },
      });
      return;
    }

    onSave(newEvent.current);
  };

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const anchor = eventRef.current;

    if (!editor || !anchor) return;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const myRect = editor.getBoundingClientRect();

      const top = isMobile ? 0 : rect.top - myRect.height * 0.25;
      const left = isMobile
        ? window.innerWidth / 2 - myRect.width / 2
        : rect.left + rect.width / 2 - myRect.width / 2;

      setPos({
        top: clamp(top, 0, window.innerHeight - myRect.height),
        left: clamp(left, 0, window.innerWidth - myRect.width),
      });
    };

    updatePosition();

    const ro = new ResizeObserver(updatePosition);
    ro.observe(editor);

    return () => ro.disconnect();
  }, [isMobile, eventRef]);

  // keybindings
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      // close the editor with escape
      if (e.key === "Escape") onCancel();

      // save the event with ctrl + s
      if (e.key === "s" && e.ctrlKey) {
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onCancel, handleSave]);

  // sync ref with state
  useEffect(() => {
    newEvent.current.title = title;
    newEvent.current.description = description;
    newEvent.current.color = color;
    newEvent.current.start = DateTime.fromJSDate(start || new Date());
    newEvent.current.end = DateTime.fromJSDate(end || new Date());
    newEvent.current.timestamp = Date.now();
  });

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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className="flex flex-col gap-5 my-3"
      >
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
            className="resize-none md:resize-y h-30 md:h-auto max-h-50"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </form>
      <div className="flex flex-wrap items-end justify-between mt-5">
        <Button
          size="icon"
          variant="secondary"
          type="button"
          onClick={onDelete}
        >
          <Trash2Icon />
        </Button>
        <div className="flex gap-3">
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </div>
    </div>
  );
}
