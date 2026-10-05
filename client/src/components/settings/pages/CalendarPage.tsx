import { memo, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  EVENT_COLOR_FALLBACK,
  MAX_EVENT_COLOR_PRESETS,
  useCalendarSettings,
} from "@/context/CalendarSettingsContext";
import { useTheme } from "@/components/ThemeProvider";
import { defaultCalendarSettings } from "@/lib/settingsDefaults";
import { DARK_COLORS, LIGHT_COLORS } from "@/lib/themeColors";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useDragReorder } from "@/hooks/useDragReorder";
import { cn, cssColorToHex } from "@/lib/utils";
import { resolveDefaultName } from "@/lib/calendar/defaultNames";
import { generateThemeColorPresets } from "@/lib/calendar/colorPresets";
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
import { SelectItem } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ResetToDefault from "../ResetToDefault";
import { sectionLabel, settingLabel, settingLabelId } from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import Section from "../SettingsSection";
import SettingsLabel from "../SettingsLabel";
import SyncToggle from "../SyncToggle";
import SettingsSelect from "../SettingsSelect";
import SettingsSlider from "../SettingsSlider";
import EventEditorPreview from "../EventEditorPreview";
import DeferredContent from "../DeferredContent";
import { useTranslation } from "react-i18next";

const ColorPresetsField = memo(function ColorPresetsField() {
  const { t } = useTranslation();
  const { eventColorPresets, setSetting } = useCalendarSettings();
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
    toast.success(t("settings.calendar.colorsGenerated"));
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
    onKeyDown,
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
            <SyncToggle settingKey="eventColorPresets" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5 text-muted-foreground hover:text-foreground"
                  aria-label={t("settings.calendar.generate")}
                  onClick={generateFromTheme}
                >
                  <Sparkles className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("settings.calendar.generate")}</TooltipContent>
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
            {t("settings.calendar.colorsHelp")}
          </FieldDescription>
        </FieldContent>

        <div className="flex items-center gap-2">
          <ColorPicker
            aria-label={t("settings.calendar.newColor")}
            value={newColor}
            onChange={setNewColor}
          />
          {isDuplicate || isLimitReached ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* eslint-disable-next-line */}
                <span tabIndex={0}>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("settings.calendar.addColor")}
                    disabled
                  >
                    <Plus />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {isLimitReached
                  ? t("settings.calendar.colorLimit", {
                      count: MAX_EVENT_COLOR_PRESETS,
                    })
                  : t("settings.calendar.alreadyAdded")}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("settings.calendar.addColor")}
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
                aria-label={t("settings.calendar.remove", {
                  name: presetColor,
                })}
                aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight"
                onPointerDown={onPointerDown(index, () => removeColor(index))}
                onKeyDown={(e) => {
                  onKeyDown(index)(e);
                  if (["Enter", " ", "Delete", "Backspace"].includes(e.key)) {
                    e.preventDefault();
                    removeColor(index);
                  }
                }}
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
  useTranslation();
  const { defaultEventName, setSetting } = useCalendarSettings();
  const field = useDebouncedSetting(defaultEventName, (value) =>
    setSetting("defaultEventName", value),
  );

  return (
    <Field orientation="responsive">
      <SettingsLabel settingKey="defaultEventName" onReset={field.cancel} />
      <Input
        aria-labelledby={settingLabelId("defaultEventName")}
        value={resolveDefaultName("defaultEventName", field.value)}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.flush}
        className="w-[220px]"
      />
    </Field>
  );
});

const DefaultTaskNameField = memo(function DefaultTaskNameField() {
  useTranslation();
  const { defaultTaskName, setSetting } = useCalendarSettings();
  const field = useDebouncedSetting(defaultTaskName, (value) =>
    setSetting("defaultTaskName", value),
  );

  return (
    <Field orientation="responsive">
      <SettingsLabel settingKey="defaultTaskName" onReset={field.cancel} />
      <Input
        aria-labelledby={settingLabelId("defaultTaskName")}
        value={resolveDefaultName("defaultTaskName", field.value)}
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
  const { t } = useTranslation();
  const {
    defaultView,
    lineOpacity,
    dayHeaderPosition,
    timeLabelPosition,
    agendaEnabled,
    miniCalendarEnabled,
    miniCalendarEventBars,
    miniCalendarWeekNumbers,
    miniCalendarBoldDayNumbers,
    miniCalendarAdaptiveNumbers,
    miniCalendarDropdowns,
    detachRecurringOnEdit,
    eventClickAction,
    eventDoubleClickAction,
    addColorsAutomatically,
    eventEditorOpacity,
    eventEditorBlur,
    eventEditorRadius,
    setSetting,
  } = useCalendarSettings();

  const [preview, setPreview] = useState({
    lineOpacity,
    eventEditorOpacity,
    eventEditorBlur,
    eventEditorRadius,
  });
  const trackPreview = (key: keyof typeof preview) => (value: number) =>
    setPreview((prev) =>
      prev[key] === value ? prev : { ...prev, [key]: value },
    );

  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">
        {t("settings.categories.calendar")}
      </h2>

      <Section
        id="behavior"
        label={sectionLabel("behavior")}
        sectionRefs={sectionRefs}
      >
        <Field orientation="responsive">
          <SettingsLabel settingKey="detachRecurringOnEdit" />
          <Switch
            aria-labelledby={settingLabelId("detachRecurringOnEdit")}
            checked={detachRecurringOnEdit}
            onCheckedChange={(checked) =>
              setSetting("detachRecurringOnEdit", checked)
            }
          />
        </Field>

        {(
          [
            ["eventClickAction", eventClickAction],
            ["eventDoubleClickAction", eventDoubleClickAction],
          ] as const
        ).map(([key, value]) => (
          <Field key={key} orientation="responsive">
            <SettingsLabel settingKey={key} />
            <SettingsSelect
              labelledBy={settingLabelId(key)}
              value={value}
              onValueChange={(action) =>
                setSetting(key, action as typeof value)
              }
            >
              <SelectItem value="none">
                {t("settings.calendar.actionNone")}
              </SelectItem>
              <SelectItem value="edit">
                {t("settings.calendar.actionEdit")}
              </SelectItem>
              <SelectItem value="details">
                {t("settings.calendar.actionDetails")}
              </SelectItem>
            </SettingsSelect>
          </Field>
        ))}
      </Section>

      <Separator />

      <Section id="grid" label={sectionLabel("grid")} sectionRefs={sectionRefs}>
        <Field orientation="responsive">
          <SettingsLabel settingKey="defaultView" />
          <SettingsSelect
            labelledBy={settingLabelId("defaultView")}
            value={defaultView}
            onValueChange={(value) =>
              setSetting("defaultView", value as typeof defaultView)
            }
          >
            <SelectItem value="day">{t("view.day")}</SelectItem>
            <SelectItem value="week">{t("view.week")}</SelectItem>
          </SettingsSelect>
        </Field>

        <Field orientation="responsive">
          <SettingsLabel settingKey="dayHeaderPosition" />
          <SettingsSelect
            labelledBy={settingLabelId("dayHeaderPosition")}
            value={dayHeaderPosition}
            onValueChange={(value) =>
              setSetting("dayHeaderPosition", value as typeof dayHeaderPosition)
            }
          >
            <SelectItem value="top">{t("settings.calendar.top")}</SelectItem>
            <SelectItem value="bottom">
              {t("settings.calendar.bottom")}
            </SelectItem>
          </SettingsSelect>
        </Field>

        <Field orientation="responsive">
          <SettingsLabel settingKey="timeLabelPosition" />
          <SettingsSelect
            labelledBy={settingLabelId("timeLabelPosition")}
            value={timeLabelPosition}
            onValueChange={(value) =>
              setSetting("timeLabelPosition", value as typeof timeLabelPosition)
            }
          >
            <SelectItem value="auto">{t("settings.calendar.auto")}</SelectItem>
            <SelectItem value="left">{t("settings.calendar.left")}</SelectItem>
            <SelectItem value="right">
              {t("settings.calendar.right")}
            </SelectItem>
          </SettingsSelect>
        </Field>

        <SettingsSlider
          settingKey="snapMinutes"
          min={1}
          max={60}
          format={(v) => t("settings.minutesShort", { count: v })}
        />

        <SettingsSlider
          settingKey="lineOpacity"
          min={0}
          max={100}
          format={(v) => `${v}%`}
          onLiveChange={trackPreview("lineOpacity")}
        />
      </Section>

      <Separator />

      <Section
        id="events"
        label={sectionLabel("events")}
        sectionRefs={sectionRefs}
      >
        <DefaultEventNameField />
        <DefaultTaskNameField />

        <SettingsSlider
          settingKey="defaultEventDuration"
          min={1}
          max={120}
          format={(v) => t("settings.minutesShort", { count: v })}
        />
      </Section>

      <Separator />

      <Section
        id="event-editor"
        label={sectionLabel("event-editor")}
        sectionRefs={sectionRefs}
      >
        <DeferredContent skeletonClassName="h-96">
          <ColorPresetsField />

          <Field orientation="responsive">
            <SettingsLabel settingKey="addColorsAutomatically" />
            <Switch
              aria-labelledby={settingLabelId("addColorsAutomatically")}
              checked={addColorsAutomatically}
              onCheckedChange={(checked) =>
                setSetting("addColorsAutomatically", checked)
              }
            />
          </Field>

          <div className="@container mt-4">
            <div className="grid gap-6 @min-[40rem]:grid-cols-[minmax(0,1fr)_auto] @min-[40rem]:items-start">
              <div className="flex flex-col gap-6">
                <SettingsSlider
                  settingKey="eventEditorOpacity"
                  min={0}
                  max={100}
                  format={(v) => `${v}%`}
                  onLiveChange={trackPreview("eventEditorOpacity")}
                />
                <SettingsSlider
                  settingKey="eventEditorBlur"
                  min={0}
                  max={40}
                  format={(v) => `${v}px`}
                  onLiveChange={trackPreview("eventEditorBlur")}
                />
                <SettingsSlider
                  settingKey="eventEditorRadius"
                  min={0}
                  max={24}
                  format={(v) => `${v}px`}
                  onLiveChange={trackPreview("eventEditorRadius")}
                />
              </div>
              <EventEditorPreview
                opacity={preview.eventEditorOpacity}
                blur={preview.eventEditorBlur}
                radius={preview.eventEditorRadius}
                lineOpacity={preview.lineOpacity}
              />
            </div>
          </div>
        </DeferredContent>
      </Section>

      <Separator />

      <Section
        id="mini-calendar"
        label={sectionLabel("mini-calendar")}
        sectionRefs={sectionRefs}
      >
        <DeferredContent skeletonClassName="h-60">
          <Field orientation="responsive">
            <SettingsLabel settingKey="miniCalendarEnabled" />
            <Switch
              aria-labelledby={settingLabelId("miniCalendarEnabled")}
              checked={miniCalendarEnabled}
              onCheckedChange={(checked) =>
                setSetting("miniCalendarEnabled", checked)
              }
            />
          </Field>

          <Field orientation="responsive">
            <SettingsLabel settingKey="miniCalendarEventBars" />
            <Switch
              aria-labelledby={settingLabelId("miniCalendarEventBars")}
              checked={miniCalendarEventBars}
              disabled={!miniCalendarEnabled}
              onCheckedChange={(checked) =>
                setSetting("miniCalendarEventBars", checked)
              }
            />
          </Field>

          {miniCalendarEventBars && (
            <Field orientation="responsive">
              <SettingsLabel settingKey="miniCalendarAdaptiveNumbers" />
              <Switch
                aria-labelledby={settingLabelId("miniCalendarAdaptiveNumbers")}
                checked={miniCalendarAdaptiveNumbers}
                disabled={!miniCalendarEnabled}
                onCheckedChange={(checked) =>
                  setSetting("miniCalendarAdaptiveNumbers", checked)
                }
              />
            </Field>
          )}

          <Field orientation="responsive">
            <SettingsLabel settingKey="miniCalendarWeekNumbers" />
            <Switch
              aria-labelledby={settingLabelId("miniCalendarWeekNumbers")}
              checked={miniCalendarWeekNumbers}
              disabled={!miniCalendarEnabled}
              onCheckedChange={(checked) =>
                setSetting("miniCalendarWeekNumbers", checked)
              }
            />
          </Field>

          <Field orientation="responsive">
            <SettingsLabel settingKey="miniCalendarBoldDayNumbers" />
            <Switch
              aria-labelledby={settingLabelId("miniCalendarBoldDayNumbers")}
              checked={miniCalendarBoldDayNumbers}
              disabled={!miniCalendarEnabled}
              onCheckedChange={(checked) =>
                setSetting("miniCalendarBoldDayNumbers", checked)
              }
            />
          </Field>

          <Field orientation="responsive">
            <SettingsLabel settingKey="miniCalendarDropdowns" />
            <Switch
              aria-labelledby={settingLabelId("miniCalendarDropdowns")}
              checked={miniCalendarDropdowns}
              disabled={!miniCalendarEnabled}
              onCheckedChange={(checked) =>
                setSetting("miniCalendarDropdowns", checked)
              }
            />
          </Field>
        </DeferredContent>
      </Section>

      <Separator />

      <Section
        id="agenda"
        label={sectionLabel("agenda")}
        sectionRefs={sectionRefs}
      >
        <DeferredContent skeletonClassName="h-24">
          <Field orientation="responsive">
            <SettingsLabel settingKey="agendaEnabled" />
            <Switch
              aria-labelledby={settingLabelId("agendaEnabled")}
              checked={agendaEnabled}
              onCheckedChange={(checked) =>
                setSetting("agendaEnabled", checked)
              }
            />
          </Field>

          <SettingsSlider
            settingKey="agendaRangeDays"
            min={1}
            max={14}
            format={(v) => t("settings.days", { count: v })}
            disabled={!agendaEnabled}
          />
        </DeferredContent>
      </Section>
    </FieldGroup>
  );
}
