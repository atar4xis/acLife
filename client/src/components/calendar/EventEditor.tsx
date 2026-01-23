import type { CalendarEvent, RepeatInterval } from "@/types/calendar/Event";
import type { EventBlockProps } from "@/types/Props";
import {
  useCallback,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";

/* ------------------------------------------------- */

// TODO: make these configurable
const presetRepeat: Record<string, RepeatInterval> = {
  daily: {
    interval: 1,
    unit: "day",
  },
  weekly: {
    interval: 1,
    unit: "week",
  },
  workdays: {
    interval: 1,
    unit: "day",
    except: [6, 7],
  },
  monthly: {
    interval: 1,
    unit: "month",
  },
  yearly: {
    interval: 1,
    unit: "year",
  },
};

const parseRepeatValue = (value: RepeatInterval) => {
  for (const [key, preset] of Object.entries(presetRepeat)) {
    if (
      value.interval === preset.interval &&
      value.unit === preset.unit &&
      value.except?.join(",") === preset.except?.join(",")
    ) {
      return key;
    }
  }

  return "custom";
};

/* ------------------------------------------------- */

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
  const [repeat, setRepeat] = useState(event.repeat);
  const [customRepeat, setCustomRepeat] = useState(
    event.repeat ? parseRepeatValue(event.repeat) === "custom" : false,
  );
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

  const handleSave = useCallback(() => {
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

    // make sure it's at least 1 minute
    if (
      newEvent.current.end.toMillis() - newEvent.current.start.toMillis() <
      60000
    ) {
      toast.warning("Invalid event duration.", {
        cancel: {
          label: "OK",
          onClick: () => {},
        },
      });
      return;
    }

    // make sure the encrypted data will be less than 10,000 bytes
    // with the current implementation 9971 is the maximum size
    if (
      new TextEncoder().encode(JSON.stringify(newEvent.current)).length > 9971
    ) {
      toast.warning("The event is too large.", {
        cancel: {
          label: "OK",
          onClick: () => {},
        },
      });
      return;
    }

    onSave(newEvent.current);
  }, [onSave]);

  const handleSelectRepeat = (value: string) => {
    if (value === "custom") {
      setRepeat({
        interval: 2,
        unit: "day",
      });
      setCustomRepeat(true);
      return;
    } else {
      setCustomRepeat(false);
    }

    if (value in presetRepeat) {
      const { interval, unit, except } =
        presetRepeat[value as keyof typeof presetRepeat];

      setRepeat({
        interval,
        unit,
        except,
      });
    } else {
      setRepeat(undefined);
    }
  };

  useLayoutEffect(() => {
    const editor = editorRef.current;
    const anchor = eventRef.current;

    if (!editor || !anchor) return;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const myRect = editor.getBoundingClientRect();

      const top = isMobile ? 0 : rect.top - myRect.height * 0.15;
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

  // close on outside click
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      const el = e.target as Element;
      if (
        editorRef.current &&
        !editorRef.current.contains(el) &&
        !el.closest("[role=dialog]") && // color/date picker
        !el.closest("[role=presentation]") // select dropdown
      ) {
        e.stopPropagation();
        onCancel();
      }
    };

    window.addEventListener("pointerdown", listener, { capture: true });
    return () =>
      window.removeEventListener("pointerdown", listener, { capture: true });
  }, [onCancel]);

  // sync ref with state
  useEffect(() => {
    newEvent.current.title = title;
    newEvent.current.description = description;
    newEvent.current.color = color;
    newEvent.current.start = DateTime.fromJSDate(start || new Date());
    newEvent.current.end = DateTime.fromJSDate(end || new Date());
    newEvent.current.repeat = repeat;
    newEvent.current.timestamp = Date.now();
  }, [title, description, color, start, end, repeat]);

  return (
    <div
      className="fixed z-20 left-0 top-0 flex flex-col justify-center md:block bg-card/80 backdrop-blur-[10px] p-3 px-5 md:px-3 shadow-lg border md:rounded-lg w-full h-full md:w-auto md:h-auto"
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

          <Select
            value={
              repeat
                ? customRepeat
                  ? "custom"
                  : parseRepeatValue(repeat)
                : "never"
            }
            onValueChange={handleSelectRepeat}
          >
            <SelectTrigger>
              <SelectValue placeholder="Repeat" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="never">Does not repeat</SelectItem>
              <SelectItem value="daily">Repeat daily</SelectItem>
              <SelectItem value="workdays">
                Repeat daily, except weekends
              </SelectItem>
              <SelectItem value="weekly">Repeat weekly</SelectItem>
              <SelectItem value="monthly">Repeat monthly</SelectItem>
              <SelectItem value="yearly">Repeat yearly</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>

          {customRepeat && (
            <>
              <FieldLabel>Repeat Every</FieldLabel>
              <div className="flex gap-2">
                <Input
                  type="number"
                  className="w-20"
                  min={1}
                  max={1000}
                  placeholder="Every"
                  value={repeat?.interval || 1}
                  onChange={(e) => {
                    setRepeat(
                      (prev) =>
                        ({
                          ...prev,
                          interval: e.target.valueAsNumber,
                        }) as RepeatInterval,
                    );
                  }}
                />
                <Select
                  value={repeat?.unit || "day"}
                  onValueChange={(v) => {
                    setRepeat(
                      (prev) =>
                        ({
                          ...prev,
                          unit: v,
                        }) as RepeatInterval,
                    );
                  }}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Days</SelectItem>
                    <SelectItem value="week">Weeks</SelectItem>
                    <SelectItem value="month">Months</SelectItem>
                    <SelectItem value="year">Years</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-between">
                <div className="flex items-start gap-2 mx-1">
                  <Checkbox
                    id="forever"
                    checked={!repeat?.until}
                    onCheckedChange={(c) => {
                      setRepeat((prev) => {
                        return {
                          ...prev,
                          until: c ? undefined : Date.now(),
                        } as RepeatInterval;
                      });
                    }}
                  />
                  <Label htmlFor="forever">Forever</Label>
                </div>
                <div className="flex items-start gap-2 mx-1">
                  <Label htmlFor="except">Excluding</Label>
                  <Checkbox
                    id="except"
                    checked={repeat?.except !== undefined}
                    onCheckedChange={(c) => {
                      setRepeat((prev) => {
                        return {
                          ...prev,
                          except: c ? [] : undefined,
                        } as RepeatInterval;
                      });
                    }}
                  />
                </div>
              </div>
              {repeat?.except !== undefined && (
                <div className="flex justify-center">
                  <ToggleGroup
                    type="multiple"
                    variant="outline"
                    value={repeat.except.map(String)}
                    onValueChange={(e) => {
                      setRepeat((prev) => {
                        return {
                          ...prev,
                          except: e.map(Number),
                        } as RepeatInterval;
                      });
                    }}
                  >
                    <ToggleGroupItem value="1">M</ToggleGroupItem>
                    <ToggleGroupItem value="2">T</ToggleGroupItem>
                    <ToggleGroupItem value="3">W</ToggleGroupItem>
                    <ToggleGroupItem value="4">T</ToggleGroupItem>
                    <ToggleGroupItem value="5">F</ToggleGroupItem>
                    <ToggleGroupItem value="6">S</ToggleGroupItem>
                    <ToggleGroupItem value="7">S</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              )}
              {repeat?.until && (
                <>
                  <FieldLabel>Until</FieldLabel>
                  <DateTimePicker
                    value={new Date(repeat.until)}
                    onChange={(d) => {
                      setRepeat((prev) => {
                        return {
                          ...prev,
                          until: d ? d.getTime() : undefined,
                        } as RepeatInterval;
                      });
                    }}
                  />
                </>
              )}
            </>
          )}
        </Field>

        <Field>
          <FieldLabel>Description</FieldLabel>
          <Textarea
            placeholder={originalEvent.current.description}
            value={description}
            cols={originalEvent.current.description ? 50 : undefined}
            rows={
              originalEvent.current.description
                ? clamp(
                    originalEvent.current.description.split("\n").length,
                    4,
                    16,
                  )
                : undefined
            }
            className="resize-none md:resize h-30 md:h-auto max-h-50"
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
