import { memo, useMemo, useState } from "react";
import { GripVertical, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  defaultCalendarSettings,
  EVENT_COLOR_FALLBACK,
  MAX_CALENDAR_TIMEZONES,
  MAX_EVENT_COLOR_PRESETS,
  useCalendarSettings,
} from "@/context/CalendarSettingsContext";
import { DARK_COLORS, LIGHT_COLORS, useTheme } from "@/components/ThemeProvider";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useDeferredSliderValue } from "@/hooks/useDeferredSliderValue";
import { useDragReorder } from "@/hooks/useDragReorder";
import { cn, cssColorToHex } from "@/lib/utils";
import { generateThemeColorPresets } from "@/lib/calendar/colorPresets";
import {
  getAllTimezones,
  getFriendlyName,
  groupTimezonesByRegion,
  type TimezoneOption,
} from "@/lib/calendar/timezone";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ResetToDefault from "../ResetToDefault";
import { sectionLabel, settingLabel } from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import Section from "../SettingsSection";

function TimezoneOptions({ timezones }: { timezones: TimezoneOption[] }) {
  const grouped = useMemo(() => groupTimezonesByRegion(timezones), [timezones]);

  return grouped.map(({ region, timezones }) => (
    <SelectGroup key={region}>
      <SelectLabel>{region}</SelectLabel>
      {timezones.map((tz) => (
        <SelectItem key={tz.name} value={tz.name}>
          {tz.label}
        </SelectItem>
      ))}
    </SelectGroup>
  ));
}

const TimezonesField = memo(function TimezonesField() {
  const { timezones, defaultTimezone, setSetting } = useCalendarSettings(
    (s) => ({
      timezones: s.timezones,
      defaultTimezone: s.defaultTimezone,
      setSetting: s.setSetting,
    }),
  );
  const allTimezones = useMemo(() => getAllTimezones(), []);
  const additionalTimezones = useMemo(
    () => timezones.filter((tz) => tz !== defaultTimezone),
    [timezones, defaultTimezone],
  );
  const availableTimezones = useMemo(
    () => allTimezones.filter((tz) => !timezones.includes(tz.name)),
    [allTimezones, timezones],
  );
  const isLimitReached = timezones.length >= MAX_CALENDAR_TIMEZONES;

  const selectDefaultTimezone = (tz: string) => {
    setSetting("defaultTimezone", tz);
    setSetting("timezones", [tz, ...additionalTimezones.filter((t) => t !== tz)]);
    toast.success(`Time zone set to ${getFriendlyName(tz)}`);
  };

  // swaps the promoted time zone with the current default's slot
  const promoteAdditionalTimezone = (tz: string) => {
    setSetting("defaultTimezone", tz);
    setSetting("timezones", [
      tz,
      ...additionalTimezones.map((t) => (t === tz ? defaultTimezone : t)),
    ]);
    toast.success(`Time zone set to ${getFriendlyName(tz)}`);
  };

  const addTimezone = (tz: string) => {
    if (!tz || timezones.includes(tz)) return;
    setSetting("timezones", [...timezones, tz]);
  };

  const removeTimezone = (tz: string) => {
    setSetting(
      "timezones",
      timezones.filter((t) => t !== tz),
    );
  };

  const { order: orderedAdditionalTimezones, dragIndex, onPointerDown, setItemRef } =
    useDragReorder(additionalTimezones, (next) =>
      setSetting("timezones", [defaultTimezone, ...next]),
    );

  const timezoneLabel = (tz: string) =>
    allTimezones.find((t) => t.name === tz)?.label ?? tz.replace(/_/g, " ");

  return (
    <FieldGroup className="mb-2 gap-6">
      <Field orientation="responsive">
        <FieldTitle className="flex-auto font-normal">
          Default time zone
        </FieldTitle>
        <Select value={defaultTimezone} onValueChange={selectDefaultTimezone}>
          <SelectTrigger className="w-full @md/field-group:w-[320px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <TimezoneOptions timezones={allTimezones} />
          </SelectContent>
        </Select>
      </Field>

      <Field orientation="responsive">
        <FieldContent>
          <FieldTitle className="font-normal">
            Additional time zones
          </FieldTitle>
          <FieldDescription>
            Shown alongside the default time zone on the grid.
          </FieldDescription>
        </FieldContent>
        <Select value="" onValueChange={addTimezone} disabled={isLimitReached}>
          <SelectTrigger className="w-full @md/field-group:w-[320px]">
            <SelectValue placeholder="Add a time zone..." />
          </SelectTrigger>
          <SelectContent>
            <TimezoneOptions timezones={availableTimezones} />
          </SelectContent>
        </Select>
      </Field>

      {isLimitReached && (
        <span className="text-muted-foreground -mt-1 self-end text-xs">
          Maximum of {MAX_CALENDAR_TIMEZONES} time zones reached
        </span>
      )}

      {orderedAdditionalTimezones.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {orderedAdditionalTimezones.map((tz, index) => (
            <div
              key={tz}
              ref={setItemRef(index)}
              className={cn(
                "flex items-center gap-2 transition-opacity",
                dragIndex === index && "opacity-40",
              )}
            >
              <button
                type="button"
                style={{ touchAction: "none" }}
                className="text-muted-foreground cursor-grab active:cursor-grabbing"
                onPointerDown={onPointerDown(index)}
              >
                <GripVertical className="size-4" />
              </button>
              <span className="flex-1 text-sm">{timezoneLabel(tz)}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => promoteAdditionalTimezone(tz)}
              >
                Set default
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => removeTimezone(tz)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </FieldGroup>
  );
});

const ColorPresetsField = memo(function ColorPresetsField() {
  const { eventColorPresets, setSetting } = useCalendarSettings((s) => ({
    eventColorPresets: s.eventColorPresets,
    setSetting: s.setSetting,
  }));
  const { resolvedBase, colors } = useTheme();
  const [newColor, setNewColor] = useState(EVENT_COLOR_FALLBACK);

  const isDefaultPresets =
    eventColorPresets.length ===
      defaultCalendarSettings.eventColorPresets.length &&
    eventColorPresets.every(
      (color, i) =>
        color.toLowerCase() ===
        defaultCalendarSettings.eventColorPresets[i].toLowerCase(),
    );

  const generateFromTheme = () => {
    const basePalette = resolvedBase === "dark" ? DARK_COLORS : LIGHT_COLORS;
    const brandColors = (["primary", "accent", "secondary"] as const).map(
      (variable) => cssColorToHex(colors[variable] ?? basePalette[variable]),
    );
    setSetting(
      "eventColorPresets",
      generateThemeColorPresets(brandColors, resolvedBase),
    );
    toast.success("Colors generated from theme.");
  };

  const isDuplicate = eventColorPresets.some(
    (presetColor) => presetColor.toLowerCase() === newColor.toLowerCase(),
  );
  const isLimitReached = eventColorPresets.length >= MAX_EVENT_COLOR_PRESETS;

  const addColor = () => {
    if (isDuplicate || isLimitReached) return;
    setSetting("eventColorPresets", [...eventColorPresets, newColor]);
  };

  const removeColor = (index: number) => {
    setSetting(
      "eventColorPresets",
      eventColorPresets.filter((_, i) => i !== index),
    );
  };

  const {
    order: orderedColorPresets,
    dragIndex,
    onPointerDown,
    setItemRef,
  } = useDragReorder(eventColorPresets, (next) =>
    setSetting("eventColorPresets", next),
  );

  return (
    <FieldGroup className="mb-2 gap-4">
      <Field orientation="responsive">
        <FieldContent>
          <div className="flex items-center gap-1.5">
            <FieldTitle>
              {settingLabel("calendar-event-editor-color-presets")}
            </FieldTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5 text-muted-foreground hover:text-foreground"
                  onClick={generateFromTheme}
                >
                  <Sparkles className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Generate from theme</TooltipContent>
            </Tooltip>
            {!isDefaultPresets && (
              <ResetToDefault
                onClick={() =>
                  setSetting(
                    "eventColorPresets",
                    defaultCalendarSettings.eventColorPresets,
                  )
                }
              />
            )}
          </div>
          <FieldDescription>
            Drag a color to reorder it, click a color to remove it.
          </FieldDescription>
        </FieldContent>

        <div className="flex items-center gap-2">
          <ColorPicker value={newColor} onChange={setNewColor} />
          {isDuplicate || isLimitReached ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button type="button" variant="outline" size="icon" disabled>
                    <Plus />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {isLimitReached
                  ? `Maximum of ${MAX_EVENT_COLOR_PRESETS} colors reached`
                  : "Already added"}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={addColor}
            >
              <Plus />
            </Button>
          )}
        </div>
      </Field>

      <div className="flex flex-wrap gap-2">
        {orderedColorPresets.map((presetColor, index) => (
          <Tooltip key={presetColor}>
            <TooltipTrigger asChild>
              <button
                ref={setItemRef(index)}
                type="button"
                onPointerDown={onPointerDown(index, () => removeColor(index))}
                className={cn(
                  "size-8 cursor-pointer rounded border opacity-90 transition-opacity hover:opacity-100",
                  dragIndex === index && "opacity-40",
                )}
                style={{ background: presetColor, touchAction: "none" }}
              />
            </TooltipTrigger>
            <TooltipContent>{presetColor}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </FieldGroup>
  );
});

const DefaultEventNameField = memo(function DefaultEventNameField() {
  const { defaultEventName, setSetting } = useCalendarSettings((s) => ({
    defaultEventName: s.defaultEventName,
    setSetting: s.setSetting,
  }));
  const field = useDebouncedSetting(defaultEventName, (value) =>
    setSetting("defaultEventName", value),
  );

  return (
    <Field orientation="responsive">
      <div className="flex flex-auto items-center gap-1.5">
        <FieldTitle>{settingLabel("calendar-default-event-name")}</FieldTitle>
        {defaultEventName !== defaultCalendarSettings.defaultEventName && (
          <ResetToDefault
            onClick={() => {
              field.cancel();
              setSetting(
                "defaultEventName",
                defaultCalendarSettings.defaultEventName,
              );
            }}
          />
        )}
      </div>
      <Input
        value={field.value}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.flush}
        className="w-[220px]"
      />
    </Field>
  );
});

const DefaultTaskNameField = memo(function DefaultTaskNameField() {
  const { defaultTaskName, setSetting } = useCalendarSettings((s) => ({
    defaultTaskName: s.defaultTaskName,
    setSetting: s.setSetting,
  }));
  const field = useDebouncedSetting(defaultTaskName, (value) =>
    setSetting("defaultTaskName", value),
  );

  return (
    <Field orientation="responsive">
      <div className="flex flex-auto items-center gap-1.5">
        <FieldTitle>{settingLabel("calendar-default-task-name")}</FieldTitle>
        {defaultTaskName !== defaultCalendarSettings.defaultTaskName && (
          <ResetToDefault
            onClick={() => {
              field.cancel();
              setSetting(
                "defaultTaskName",
                defaultCalendarSettings.defaultTaskName,
              );
            }}
          />
        )}
      </div>
      <Input
        value={field.value}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.flush}
        className="w-[220px]"
      />
    </Field>
  );
});

export default function CalendarPage({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  const {
    defaultView,
    weekStartsOn,
    snapMinutes,
    defaultEventDuration,
    agendaEnabled,
    agendaRangeDays,
    addColorsAutomatically,
    setSetting,
  } = useCalendarSettings((s) => ({
    defaultView: s.defaultView,
    weekStartsOn: s.weekStartsOn,
    snapMinutes: s.snapMinutes,
    defaultEventDuration: s.defaultEventDuration,
    agendaEnabled: s.agendaEnabled,
    agendaRangeDays: s.agendaRangeDays,
    addColorsAutomatically: s.addColorsAutomatically,
    setSetting: s.setSetting,
  }));

  const snapMinutesSlider = useDeferredSliderValue(snapMinutes, (value) =>
    setSetting("snapMinutes", value),
  );
  const defaultEventDurationSlider = useDeferredSliderValue(
    defaultEventDuration,
    (value) => setSetting("defaultEventDuration", value),
  );
  const agendaRangeDaysSlider = useDeferredSliderValue(
    agendaRangeDays,
    (value) => setSetting("agendaRangeDays", value),
  );

  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">Calendar</h2>

      <Section
        id="timezones"
        label={sectionLabel("timezones")}
        sectionRefs={sectionRefs}
      >
        <TimezonesField />
      </Section>

      <Separator />

      <Section id="grid" label={sectionLabel("grid")} sectionRefs={sectionRefs}>
        <Field orientation="responsive">
          <div className="flex flex-auto items-center gap-1.5">
            <FieldTitle>{settingLabel("calendar-default-view")}</FieldTitle>
            {defaultView !== defaultCalendarSettings.defaultView && (
              <ResetToDefault
                onClick={() =>
                  setSetting("defaultView", defaultCalendarSettings.defaultView)
                }
              />
            )}
          </div>
          <Select
            value={defaultView}
            onValueChange={(value) =>
              setSetting("defaultView", value as typeof defaultView)
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="responsive">
          <div className="flex flex-auto items-center gap-1.5">
            <FieldTitle>{settingLabel("calendar-week-start")}</FieldTitle>
            {weekStartsOn !== defaultCalendarSettings.weekStartsOn && (
              <ResetToDefault
                onClick={() =>
                  setSetting(
                    "weekStartsOn",
                    defaultCalendarSettings.weekStartsOn,
                  )
                }
              />
            )}
          </div>
          <Select
            value={weekStartsOn}
            onValueChange={(value) =>
              setSetting("weekStartsOn", value as typeof weekStartsOn)
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mon">Monday</SelectItem>
              <SelectItem value="sun">Sunday</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FieldTitle>{settingLabel("calendar-snap-minutes")}</FieldTitle>
                {snapMinutes !== defaultCalendarSettings.snapMinutes && (
                  <ResetToDefault
                    onClick={() =>
                      setSetting(
                        "snapMinutes",
                        defaultCalendarSettings.snapMinutes,
                      )
                    }
                  />
                )}
              </div>
              <span className="text-muted-foreground text-sm">
                {snapMinutesSlider.value} min
              </span>
            </div>
          </FieldContent>
          <Slider
            className="mt-1"
            min={1}
            max={30}
            step={1}
            value={[snapMinutesSlider.value]}
            onValueChange={snapMinutesSlider.onValueChange}
            onValueCommit={snapMinutesSlider.onValueCommit}
          />
        </Field>
      </Section>

      <Separator />

      <Section
        id="events"
        label={sectionLabel("events")}
        sectionRefs={sectionRefs}
      >
        <DefaultEventNameField />
        <DefaultTaskNameField />

        <Field>
          <FieldContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FieldTitle>
                  {settingLabel("calendar-default-event-duration")}
                </FieldTitle>
                {defaultEventDuration !==
                  defaultCalendarSettings.defaultEventDuration && (
                  <ResetToDefault
                    onClick={() =>
                      setSetting(
                        "defaultEventDuration",
                        defaultCalendarSettings.defaultEventDuration,
                      )
                    }
                  />
                )}
              </div>
              <span className="text-muted-foreground text-sm">
                {defaultEventDurationSlider.value} min
              </span>
            </div>
          </FieldContent>
          <Slider
            className="mt-1"
            min={1}
            max={120}
            step={1}
            value={[defaultEventDurationSlider.value]}
            onValueChange={defaultEventDurationSlider.onValueChange}
            onValueCommit={defaultEventDurationSlider.onValueCommit}
          />
        </Field>
      </Section>

      <Separator />

      <Section
        id="event-editor"
        label={sectionLabel("event-editor")}
        sectionRefs={sectionRefs}
      >
        <ColorPresetsField />

        <Field orientation="responsive">
          <div className="flex flex-auto items-center gap-1.5">
            <FieldTitle>
              {settingLabel("calendar-event-editor-add-colors-automatically")}
            </FieldTitle>
            {addColorsAutomatically !==
              defaultCalendarSettings.addColorsAutomatically && (
              <ResetToDefault
                onClick={() =>
                  setSetting(
                    "addColorsAutomatically",
                    defaultCalendarSettings.addColorsAutomatically,
                  )
                }
              />
            )}
          </div>
          <Switch
            checked={addColorsAutomatically}
            onCheckedChange={(checked) =>
              setSetting("addColorsAutomatically", checked)
            }
          />
        </Field>
      </Section>

      <Separator />

      <Section
        id="agenda"
        label={sectionLabel("agenda")}
        sectionRefs={sectionRefs}
      >
        <Field orientation="responsive">
          <div className="flex flex-auto items-center gap-1.5">
            <FieldTitle>{settingLabel("calendar-agenda-enabled")}</FieldTitle>
            {agendaEnabled !== defaultCalendarSettings.agendaEnabled && (
              <ResetToDefault
                onClick={() =>
                  setSetting(
                    "agendaEnabled",
                    defaultCalendarSettings.agendaEnabled,
                  )
                }
              />
            )}
          </div>
          <Switch
            checked={agendaEnabled}
            onCheckedChange={(checked) => setSetting("agendaEnabled", checked)}
          />
        </Field>

        <Field>
          <FieldContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FieldTitle>{settingLabel("calendar-agenda-range")}</FieldTitle>
                {agendaRangeDays !==
                  defaultCalendarSettings.agendaRangeDays && (
                  <ResetToDefault
                    onClick={() =>
                      setSetting(
                        "agendaRangeDays",
                        defaultCalendarSettings.agendaRangeDays,
                      )
                    }
                  />
                )}
              </div>
              <span className="text-muted-foreground text-sm">
                {agendaRangeDaysSlider.value}{" "}
                {agendaRangeDaysSlider.value === 1 ? "day" : "days"}
              </span>
            </div>
          </FieldContent>
          <Slider
            className="mt-1"
            min={1}
            max={14}
            step={1}
            disabled={!agendaEnabled}
            value={[agendaRangeDaysSlider.value]}
            onValueChange={agendaRangeDaysSlider.onValueChange}
            onValueCommit={agendaRangeDaysSlider.onValueCommit}
          />
        </Field>
      </Section>
    </FieldGroup>
  );
}
