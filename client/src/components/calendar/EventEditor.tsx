import type { CalendarEvent, RepeatInterval } from "@/types/calendar/Event";
import type { EventBlockProps } from "@/types/Props";
import { MAX_EVENT_DURATION_MINUTES } from "@/lib/calendar/event";
import { lastInputModality } from "@/lib/inputModality";
import useFocusTrap from "@/hooks/useFocusTrap";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Field, FieldLabel } from "../ui/field";
import { Textarea } from "../ui/textarea";
import { ColorPicker } from "../ui/color-picker";
import {
  EVENT_COLOR_FALLBACK,
  useCalendarSettings,
} from "@/context/CalendarSettingsContext";
import { clamp } from "@/lib/utils";
import { DateTimePicker } from "./DateTimePicker";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Clipboard,
  CopyIcon,
  MoreVerticalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "../ui/dropdown-menu";
import { MoveMenuItems } from "./MoveMenuItems";
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
  day,
  eventRef,
  restoreFocus,
  onSave,
  onMove,
  onDelete,
  onCancel,
  onDuplicate,
  preview,
}: Partial<EventBlockProps> & {
  eventRef?: RefObject<HTMLDivElement | null>;
  preview?: { opacity: number; blur: number; radius: number };
  onSave: (originalEvent: CalendarEvent, event: CalendarEvent) => void;
  onMove: (originalEvent: CalendarEvent, event: CalendarEvent) => void;
  onDelete: () => void;
  onCancel: () => void;
  onDuplicate: () => void;
}) {
  if (!event) throw new Error("invalid instance of EventEditor");

  const originalEvent = useRef(event);
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [openedByKeyboard] = useState(
    () => !preview && lastInputModality() === "keyboard",
  );
  const [opener] = useState(() => document.activeElement);
  const skipFocusRestore = useRef(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const settings = useCalendarSettings((s) => ({
    colorPresets: s.eventColorPresets,
    opacity: s.eventEditorOpacity,
    blur: s.eventEditorBlur,
    radius: s.eventEditorRadius,
  }));
  const opacity = preview?.opacity ?? settings.opacity;
  const blur = preview?.blur ?? settings.blur;
  const radius = preview?.radius ?? settings.radius;
  const [color, setColor] = useState(
    event.color || settings.colorPresets[0] || EVENT_COLOR_FALLBACK,
  );
  const [start, setStart] = useState<Date | undefined>(event.start.toJSDate());
  const [end, setEnd] = useState<Date | undefined>(event.end.toJSDate());
  const [repeat, setRepeat] = useState(event.repeat);
  const [customRepeat, setCustomRepeat] = useState(
    event.repeat ? parseRepeatValue(event.repeat) === "custom" : false,
  );
  const [isTask, setIsTask] = useState(event.isTask ?? false);
  const [completed, setCompleted] = useState(event.completed ?? false);
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

  const copyID = useCallback(() => {
    navigator.clipboard.writeText(event._parent || event.id);
  }, [event.id, event._parent]);

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

    if (
      newEvent.current.end.diff(newEvent.current.start).as("minutes") >
      MAX_EVENT_DURATION_MINUTES
    ) {
      toast.warning("An event cannot last this long.", {
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

    onSave(originalEvent.current, newEvent.current);
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
    const anchor = eventRef?.current;

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

  useEffect(() => {
    if (!openedByKeyboard) return;

    const focusTitle = () => titleRef.current?.focus({ preventScroll: true });
    focusTitle();

    // a menu that is still closing keeps focus trapped, so check again once it is gone
    const timer = setTimeout(() => {
      if (!editorRef.current?.contains(document.activeElement)) focusTitle();
    }, 0);
    return () => clearTimeout(timer);
  }, [openedByKeyboard]);

  const closing = useRef({ restoreFocus, day, event });
  closing.current = { restoreFocus, day, event };

  useLayoutEffect(() => {
    return () => {
      if (!openedByKeyboard || skipFocusRestore.current) return;

      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        !active.closest("[role=dialog], [role=alertdialog]")
      )
        return;

      const latest = closing.current;
      latest.restoreFocus?.(opener, latest.event, latest.day ?? 0);
    };
  }, [openedByKeyboard, opener]);

  useFocusTrap(editorRef, !preview);

  // keybindings
  useEffect(() => {
    if (preview) return;

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
  }, [onCancel, handleSave, preview]);

  // close on outside click
  useEffect(() => {
    if (preview) return;

    const listener = (e: MouseEvent) => {
      const el = e.target as Element;
      if (
        editorRef.current &&
        !editorRef.current.contains(el) &&
        !el.closest("[role=dialog]") && // color/date picker
        !el.closest("[role=presentation]") && // select dropdown
        !el.closest("[data-sonner-toast]") &&
        !el.closest('[data-slot^="dropdown-menu"]')
      ) {
        e.stopPropagation();
        // a press inside the recurring dialog is not the user going elsewhere
        skipFocusRestore.current = !el.closest("[role=alertdialog]");
        onCancel();
      }
    };

    window.addEventListener("pointerdown", listener, { capture: true });
    return () =>
      window.removeEventListener("pointerdown", listener, { capture: true });
  }, [onCancel, preview]);

  // sync ref with state
  useEffect(() => {
    newEvent.current.title = title;
    newEvent.current.description = description;
    newEvent.current.color = color;
    newEvent.current.start = DateTime.fromJSDate(start || new Date());
    newEvent.current.end = DateTime.fromJSDate(end || new Date());
    newEvent.current.repeat = repeat;
    newEvent.current.isTask = isTask;
    newEvent.current.completed = isTask ? completed : undefined;
    newEvent.current.timestamp = Date.now();
  }, [title, description, color, start, end, repeat, isTask, completed]);

  const editor = (
    <div
      className={
        preview
          ? "event-editor relative pointer-events-none select-none p-3 px-3 shadow-lg border rounded-(--editor-radius)"
          : "pointer-events-auto event-editor fixed z-20 left-0 top-0 flex flex-col justify-center md:block p-3 px-5 md:px-3 shadow-lg border md:rounded-(--editor-radius) w-full h-full md:w-auto md:h-auto"
      }
      style={
        {
          top: preview ? undefined : pos.top,
          left: preview ? undefined : pos.left,
          backgroundColor: `color-mix(in srgb, var(--card) ${opacity}%, transparent)`,
          backdropFilter: `blur(${blur}px)`,
          "--editor-radius": `${radius}px`,
        } as CSSProperties
      }
      ref={editorRef}
      role={preview ? undefined : "dialog"}
      aria-modal={preview ? undefined : "true"}
      aria-labelledby={preview ? undefined : titleId}
      aria-hidden={preview ? true : undefined}
      inert={!!preview}
    >
      <div className="flex justify-between mb-5 items-center">
        <h3 id={titleId} className="text-xl font-semibold">
          Edit Event
        </h3>
        <div className="flex items-center gap-1">
          {/* the context menu on the event block is disabled on mobile
              (it conflicts with hold-to-drag), so expose it here instead */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="More actions"
              >
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={copyID}>
                <Clipboard />
                {event._parent ? "Copy parent ID" : "Copy ID"}
              </DropdownMenuItem>

              {/* Move submenu (mobile) */}
              <MoveMenuItems
                event={originalEvent.current}
                onMove={onMove}
                menu={{
                  Sub: DropdownMenuSub,
                  SubTrigger: DropdownMenuSubTrigger,
                  SubContent: DropdownMenuSubContent,
                  Item: DropdownMenuItem,
                  Separator: DropdownMenuSeparator,
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            onClick={onCancel}
          >
            <XIcon />
          </Button>
        </div>
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
              ref={titleRef}
              type="text"
              className="mr-2"
              placeholder={originalEvent.current.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <ColorPicker
              aria-label="Event color"
              presetColors={settings.colorPresets}
              onChange={(v) => {
                setColor(v as string);
              }}
              value={color}
            />
          </div>
        </Field>

        <Field>
          <FieldLabel>Start &amp; End Time</FieldLabel>
          <DateTimePicker label="Start" value={start} onChange={setStart} />
          <DateTimePicker label="End" value={end} onChange={setEnd} />

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
            <SelectTrigger aria-label="Repeat">
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
                  <SelectTrigger className="flex-1" aria-label="Repeat unit">
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
                    label="Until"
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
            className="resize-none md:resize min-w-80 h-30 md:h-auto max-h-50"
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <Field className="-mt-1">
          <div className="flex items-start justify-between px-1">
            <div className="flex items-start gap-2">
              <Checkbox
                id="isTask"
                checked={isTask}
                onCheckedChange={(c) => setIsTask(!!c)}
              />
              <Label htmlFor="isTask">Task</Label>
            </div>
            {isTask && (
              <div className="flex items-start gap-2">
                <Label htmlFor="completed">Completed</Label>
                <Checkbox
                  id="completed"
                  checked={completed}
                  onCheckedChange={(c) => setCompleted(!!c)}
                />
              </div>
            )}
          </div>
        </Field>
      </form>
      <div className="flex flex-wrap items-end justify-between mt-5">
        <div className="flex gap-3">
          <Button
            size="icon"
            variant="secondary"
            type="button"
            aria-label="Delete event"
            onClick={onDelete}
          >
            <Trash2Icon />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            type="button"
            aria-label="Duplicate event"
            onClick={onDuplicate}
          >
            <CopyIcon />
          </Button>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </div>
    </div>
  );

  return preview ? editor : createPortal(editor, document.body);
}
