import { memo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import {
  CUSTOM_NOTIFICATION_SOUND,
  NOTIFICATION_SOUNDS,
} from "@/lib/settingsDefaults";
import {
  MAX_CUSTOM_SOUND_BYTES,
  playNotificationSound,
  readCustomSound,
} from "@/lib/calendar/notifications";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { resolveDefaultName } from "@/lib/calendar/defaultNames";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectItem } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import ColorPresetsSettings from "../ColorPresetsSettings";
import ResetToDefault from "../ResetToDefault";
import { sectionLabel, settingLabel, settingLabelId } from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import Section from "../SettingsSection";
import SettingsLabel from "../SettingsLabel";
import SyncToggle from "../SyncToggle";
import SettingsSelect from "../SettingsSelect";
import SettingsSlider from "../SettingsSlider";
import EventEditorPreview from "../EventEditorPreview";
import NotificationsField, {
  AddNotificationButton,
} from "@/components/calendar/NotificationsField";
import DeferredContent from "../DeferredContent";
import { useTranslation } from "react-i18next";
import { formatDuration } from "@/lib/utils";

const DefaultEventNameField = memo(function DefaultEventNameField() {
  useTranslation();
  const { defaultEventName, setSetting } = useCalendarSettings();
  const field = useDebouncedSetting(defaultEventName, (value) =>
    setSetting("defaultEventName", value),
  );

  return (
    <Field orientation="responsive" className="min-h-9">
      <SettingsLabel settingKey="defaultEventName" onReset={field.cancel} />
      <Input
        aria-labelledby={settingLabelId("defaultEventName")}
        value={resolveDefaultName("defaultEventName", field.value)}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.flush}
        className="w-55"
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
    <Field orientation="responsive" className="min-h-9">
      <SettingsLabel settingKey="defaultTaskName" onReset={field.cancel} />
      <Input
        aria-labelledby={settingLabelId("defaultTaskName")}
        value={resolveDefaultName("defaultTaskName", field.value)}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.flush}
        className="w-55"
      />
    </Field>
  );
});

const DefaultNotificationsField = memo(function DefaultNotificationsField() {
  useTranslation();
  const { defaultEventNotifications, setSetting } = useCalendarSettings();

  return (
    <Field>
      <div className="flex items-center gap-1.5">
        <FieldTitle id={settingLabelId("defaultEventNotifications")}>
          {settingLabel("calendar-default-event-notifications")}
        </FieldTitle>
        <AddNotificationButton
          value={defaultEventNotifications}
          onChange={(value) => setSetting("defaultEventNotifications", value)}
        />
        <SyncToggle settingKey="defaultEventNotifications" />
        {defaultEventNotifications.length > 0 && (
          <ResetToDefault
            onClick={() => setSetting("defaultEventNotifications", [])}
          />
        )}
      </div>
      <NotificationsField
        value={defaultEventNotifications}
        onChange={(value) => setSetting("defaultEventNotifications", value)}
      />
    </Field>
  );
});

export default function CalendarPage({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  const { t, i18n } = useTranslation();
  const {
    defaultView,
    notificationSound,
    notificationVolume,
    lineOpacity,
    dayHeaderPosition,
    timeLabelPosition,
    agendaEnabled,
    showOverdueTasks,
    miniCalendarEnabled,
    miniCalendarEventBars,
    miniCalendarWeekNumbers,
    miniCalendarBoldDayNumbers,
    miniCalendarAdaptiveNumbers,
    miniCalendarDropdowns,
    detachRecurringOnEdit,
    followCurrentTime,
    eventClickAction,
    eventDoubleClickAction,
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
  const soundInput = useRef<HTMLInputElement>(null);
  const chooseCustomSound = async (file: File) => {
    if (!file.type.startsWith("audio/") || file.size > MAX_CUSTOM_SOUND_BYTES) {
      toast.error(t("settings.calendar.customSoundInvalid"));
      return;
    }
    const dataUrl = await readCustomSound(file);
    setSetting("notificationSound", dataUrl);
    void playNotificationSound(dataUrl, notificationVolume);
  };
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
        <Field orientation="responsive" className="min-h-9">
          <SettingsLabel settingKey="detachRecurringOnEdit" />
          <Switch
            aria-labelledby={settingLabelId("detachRecurringOnEdit")}
            checked={detachRecurringOnEdit}
            onCheckedChange={(checked) =>
              setSetting("detachRecurringOnEdit", checked)
            }
          />
        </Field>

        <Field orientation="responsive" className="min-h-9">
          <SettingsLabel settingKey="followCurrentTime" />
          <Switch
            aria-labelledby={settingLabelId("followCurrentTime")}
            checked={followCurrentTime}
            onCheckedChange={(checked) =>
              setSetting("followCurrentTime", checked)
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
        <Field orientation="responsive" className="min-h-9">
          <SettingsLabel settingKey="defaultView" />
          <SettingsSelect
            labelledBy={settingLabelId("defaultView")}
            value={defaultView}
            onValueChange={(value) =>
              setSetting("defaultView", value as typeof defaultView)
            }
          >
            <SelectItem value="default">
              {t("settings.calendar.default")}
            </SelectItem>
            <SelectItem value="day">{t("view.day")}</SelectItem>
            <SelectItem value="week">{t("view.week")}</SelectItem>
          </SettingsSelect>
        </Field>

        <Field orientation="responsive" className="min-h-9">
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

        <Field orientation="responsive" className="min-h-9">
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
        id="notifications"
        label={sectionLabel("notifications")}
        sectionRefs={sectionRefs}
      >
        <DefaultNotificationsField />

        <Field orientation="responsive" className="min-h-9">
          <SettingsLabel settingKey="notificationSound" />
          <SettingsSelect
            labelledBy={settingLabelId("notificationSound")}
            value={String(
              typeof notificationSound === "string"
                ? CUSTOM_NOTIFICATION_SOUND
                : notificationSound,
            )}
            onValueChange={(value) => {
              if (Number(value) === CUSTOM_NOTIFICATION_SOUND) {
                soundInput.current?.click();
                return;
              }
              setSetting("notificationSound", Number(value));
              void playNotificationSound(Number(value), notificationVolume);
            }}
            action={
              typeof notificationSound === "string" && (
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t("settings.calendar.customSoundReplace")}
                  onClick={() => soundInput.current?.click()}
                >
                  <Upload />
                </Button>
              )
            }
            footer={
              <input
                ref={soundInput}
                type="file"
                accept="audio/*"
                hidden
                data-testid="custom-sound-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void chooseCustomSound(file);
                }}
              />
            }
          >
            {NOTIFICATION_SOUNDS.map((number) => (
              <SelectItem key={number} value={String(number)}>
                {t("settings.calendar.notificationSound", { number })}
              </SelectItem>
            ))}
            <SelectItem value={String(CUSTOM_NOTIFICATION_SOUND)}>
              {t("settings.calendar.customSound")}
            </SelectItem>
          </SettingsSelect>
        </Field>

        <SettingsSlider
          settingKey="notificationVolume"
          min={0}
          max={100}
          format={(v) => `${v}%`}
          onCommit={(value) => {
            setSetting("notificationVolume", value);
            void playNotificationSound(notificationSound, value);
          }}
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
          <ColorPresetsSettings
            presetsKey="eventColorPresets"
            autoKey="addColorsAutomatically"
          />

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
          <Field orientation="responsive" className="min-h-9">
            <SettingsLabel settingKey="miniCalendarEnabled" />
            <Switch
              aria-labelledby={settingLabelId("miniCalendarEnabled")}
              checked={miniCalendarEnabled}
              onCheckedChange={(checked) =>
                setSetting("miniCalendarEnabled", checked)
              }
            />
          </Field>

          <Field orientation="responsive" className="min-h-9">
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
            <Field orientation="responsive" className="min-h-9">
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

          <Field orientation="responsive" className="min-h-9">
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

          <Field orientation="responsive" className="min-h-9">
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

          <Field orientation="responsive" className="min-h-9">
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
          <Field orientation="responsive" className="min-h-9">
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
            format={(v) => formatDuration(v * 86400, i18n.language)}
            disabled={!agendaEnabled}
          />

          <Field orientation="responsive" className="min-h-9">
            <SettingsLabel settingKey="showOverdueTasks" />
            <Switch
              aria-labelledby={settingLabelId("showOverdueTasks")}
              checked={showOverdueTasks}
              disabled={!agendaEnabled}
              onCheckedChange={(checked) =>
                setSetting("showOverdueTasks", checked)
              }
            />
          </Field>

          {showOverdueTasks && (
            <SettingsSlider
              settingKey="overdueDays"
              min={1}
              max={28}
              format={(v) => formatDuration(v * 86400, i18n.language)}
              disabled={!agendaEnabled}
            />
          )}
        </DeferredContent>
      </Section>
    </FieldGroup>
  );
}
