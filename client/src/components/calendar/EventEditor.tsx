import type { CalendarEvent, RepeatInterval } from "@/types/calendar/Event";
import type { EventBlockProps } from "@/types/Props";
import { MAX_EVENT_DURATION_MINUTES } from "@/lib/calendar/event";
import { moveToFirstOccurrence } from "@/lib/calendar/recurrence";
import {
  monthlyOptions,
  repeatChanged,
  repeatKey,
  withUnitDefaults,
} from "@/lib/calendar/repeatOptions";
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
import { clamp, cn } from "@/lib/utils";
import { DateTimePicker } from "./DateTimePicker";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Clipboard,
  CopyIcon,
  MoreVerticalIcon,
  PencilIcon,
  Trash2Icon,
  RotateCcw,
  TriangleAlert,
  Unlink,
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
import RepeatDialog from "./RepeatDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { useTranslation } from "react-i18next";

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
  "monthly-date": {
    interval: 1,
    unit: "month",
    monthly: "date",
  },
  "monthly-nth": {
    interval: 1,
    unit: "month",
    monthly: "nth",
  },
  "monthly-last": {
    interval: 1,
    unit: "month",
    monthly: "last",
  },
  yearly: {
    interval: 1,
    unit: "year",
  },
};

const parseRepeatValue = (value: RepeatInterval) => {
  const key = repeatKey(withUnitDefaults(value));
  return (
    Object.entries(presetRepeat).find(
      ([, preset]) => repeatKey(preset) === key,
    )?.[0] ?? "custom"
  );
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
  onDetach,
  onReset,
  preview,
}: Partial<EventBlockProps> & {
  eventRef?: RefObject<HTMLDivElement | null>;
  preview?: { opacity: number; blur: number; radius: number };
  onSave: (originalEvent: CalendarEvent, event: CalendarEvent) => void;
  onMove: (originalEvent: CalendarEvent, event: CalendarEvent) => void;
  onDelete: () => void;
  onCancel: () => void;
  onDuplicate: () => void;
  onDetach: () => void;
  onReset: () => void;
}) {
  if (!event) throw new Error("invalid instance of EventEditor");

  const { t } = useTranslation();

  const originalEvent = useRef(event);
  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const repeatRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [openedByKeyboard] = useState(
    () => !preview && lastInputModality() === "keyboard",
  );
  const [opener] = useState(() => document.activeElement);
  const skipFocusRestore = useRef(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const dragged = useRef(false);
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const settings = useCalendarSettings((s) => ({
    colorPresets: s.eventColorPresets,
    opacity: s.eventEditorOpacity,
    blur: s.eventEditorBlur,
    radius: s.eventEditorRadius,
    detachRecurring: s.detachRecurringOnEdit,
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
  const [repeatDialogOpen, setRepeatDialogOpen] = useState(false);
  const [isTask, setIsTask] = useState(event.isTask ?? false);
  const [completed, setCompleted] = useState(event.completed ?? false);
  const startTime = DateTime.fromJSDate(start || new Date());
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
      toast.warning(t("editor.endBeforeStart"), {
        cancel: {
          label: t("common.ok"),
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
      toast.warning(t("editor.invalidDuration"), {
        cancel: {
          label: t("common.ok"),
          onClick: () => {},
        },
      });
      return;
    }

    if (
      newEvent.current.end.diff(newEvent.current.start).as("minutes") >
      MAX_EVENT_DURATION_MINUTES
    ) {
      toast.warning(t("editor.tooLong"), {
        cancel: {
          label: t("common.ok"),
          onClick: () => {},
        },
      });
      return;
    }

    const except = newEvent.current.repeat?.except;
    if (new Set(except).size >= 7) {
      toast.warning(t("editor.excludesEveryDay"), {
        cancel: {
          label: t("common.ok"),
          onClick: () => {},
        },
      });
      return;
    }

    // the series should not start on a day it does not repeat on
    if (!newEvent.current._parent) {
      const moved = moveToFirstOccurrence(
        newEvent.current.start,
        newEvent.current.end,
        newEvent.current.repeat,
      );
      if (moved) Object.assign(newEvent.current, moved);
    }

    if (
      newEvent.current.repeat?.until &&
      newEvent.current.repeat.until <
        newEvent.current.start.startOf("day").toMillis()
    ) {
      toast.warning(t("editor.repeatEndsBeforeStart"), {
        cancel: {
          label: t("common.ok"),
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
      toast.warning(t("editor.tooLarge"), {
        cancel: {
          label: t("common.ok"),
          onClick: () => {},
        },
      });
      return;
    }

    onSave(originalEvent.current, newEvent.current);
  }, [onSave, t]);

  const handleSelectRepeat = (value: string) => {
    if (value === "custom") {
      setRepeatDialogOpen(true);
    } else {
      setRepeat(value in presetRepeat ? { ...presetRepeat[value] } : undefined);
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

      if (dragged.current) {
        setPos((p) => ({
          top: clamp(p.top, 0, window.innerHeight - myRect.height),
          left: clamp(p.left, 0, window.innerWidth - myRect.width),
        }));
        return;
      }

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
        !el.closest("[data-slot=dialog-overlay]") && // repeat dialog
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
      <div
        className={cn(
          "flex justify-between mb-5 items-center",
          !preview && !isMobile && "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={(e) => {
          const editor = editorRef.current;
          if (
            preview ||
            isMobile ||
            e.button !== 0 ||
            !editor ||
            (e.target as Element).closest("button")
          )
            return;

          const { width, height } = editor.getBoundingClientRect();
          const dx = e.clientX - pos.left;
          const dy = e.clientY - pos.top;
          const onMove = (m: PointerEvent) => {
            dragged.current = true;
            setPos({
              top: clamp(m.clientY - dy, 0, window.innerHeight - height),
              left: clamp(m.clientX - dx, 0, window.innerWidth - width),
            });
          };
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
      >
        <h3 id={titleId} className="text-xl font-semibold select-none">
          {t("editor.title")}
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
                aria-label={t("editor.moreActions")}
              >
                <MoreVerticalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={copyID}>
                <Clipboard />
                {event._parent ? t("block.copyParentId") : t("block.copyId")}
              </DropdownMenuItem>

              {event._parent && (
                <DropdownMenuItem onClick={onDetach}>
                  <Unlink />
                  {t("block.detach")}
                </DropdownMenuItem>
              )}

              {event._resettable && (
                <DropdownMenuItem onClick={onReset}>
                  <RotateCcw />
                  {t("block.reset")}
                </DropdownMenuItem>
              )}

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
            aria-label={t("common.close")}
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
          <FieldLabel>{t("editor.titleColor")}</FieldLabel>
          <div className="flex">
            <Input
              ref={titleRef}
              type="text"
              className="me-2"
              placeholder={originalEvent.current.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <ColorPicker
              aria-label={t("editor.eventColor")}
              presetColors={settings.colorPresets}
              onChange={(v) => {
                setColor(v as string);
              }}
              value={color}
            />
          </div>
        </Field>

        <Field>
          <FieldLabel>{t("editor.startEnd")}</FieldLabel>
          <DateTimePicker
            label={t("editor.start")}
            value={start}
            onChange={setStart}
          />
          <DateTimePicker
            label={t("editor.end")}
            value={end}
            onChange={setEnd}
          />

          <div className="flex gap-2">
            <Select
              value={repeat ? parseRepeatValue(repeat) : "never"}
              onValueChange={handleSelectRepeat}
            >
              <SelectTrigger
                ref={repeatRef}
                className="flex-1"
                aria-label={t("editor.repeat")}
              >
                <SelectValue placeholder={t("editor.repeat")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="never">{t("editor.never")}</SelectItem>
                <SelectItem value="daily">{t("editor.daily")}</SelectItem>
                <SelectItem value="workdays">{t("editor.workdays")}</SelectItem>
                <SelectItem value="weekly">{t("editor.weekly")}</SelectItem>
                {monthlyOptions(startTime, repeat?.monthly === "last").map(
                  (o) => (
                    <SelectItem key={o.value} value={`monthly-${o.value}`}>
                      {t("editor.monthly", { option: o.label })}
                    </SelectItem>
                  ),
                )}
                <SelectItem value="yearly">{t("editor.yearly")}</SelectItem>
                <SelectItem value="custom">{t("editor.custom")}</SelectItem>
              </SelectContent>
            </Select>
            {repeat && parseRepeatValue(repeat) === "custom" && (
              <Button
                variant="outline"
                size="icon"
                type="button"
                aria-label={t("editor.editCustom")}
                onClick={() => setRepeatDialogOpen(true)}
              >
                <PencilIcon />
              </Button>
            )}
          </div>
          {event._parent &&
            !settings.detachRecurring &&
            repeatChanged(repeat, event.repeat) && (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <TriangleAlert className="size-3.5 shrink-0" />
                {t("editor.detachWarning")}
              </p>
            )}
        </Field>

        <Field>
          <FieldLabel>{t("editor.description")}</FieldLabel>
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
              <Label htmlFor="isTask">{t("editor.task")}</Label>
            </div>
            {isTask && (
              <div className="flex items-start gap-2">
                <Label htmlFor="completed">{t("editor.completed")}</Label>
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
      <RepeatDialog
        open={repeatDialogOpen}
        onOpenChange={setRepeatDialogOpen}
        onCloseFocus={() => repeatRef.current?.focus()}
        start={startTime}
        initial={repeat}
        onApply={(r) => {
          setRepeat(r);
          setRepeatDialogOpen(false);
        }}
      />
      <div className="flex flex-wrap items-end justify-between mt-5">
        <div className="flex gap-3">
          <Button
            size="icon"
            variant="secondary"
            type="button"
            aria-label={t("editor.delete")}
            onClick={onDelete}
          >
            <Trash2Icon />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            type="button"
            aria-label={t("editor.duplicate")}
            onClick={onDuplicate}
          >
            <CopyIcon />
          </Button>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" type="button" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSave}>{t("common.save")}</Button>
        </div>
      </div>
    </div>
  );

  return preview ? editor : createPortal(editor, document.body);
}
