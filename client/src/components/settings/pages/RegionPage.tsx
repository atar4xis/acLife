import { DateTime, Info } from "luxon";
import { Fragment, memo, useEffect, useMemo, useState } from "react";
import { CircleHelp, GripVertical, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  MAX_CALENDAR_TIMEZONES,
  useCalendarSettings,
} from "@/context/CalendarSettingsContext";
import type { Weekday } from "@/types/calendar/Settings";
import { useWeekStart } from "@/hooks/useWeekStart";
import { useDragReorder } from "@/hooks/useDragReorder";
import { defaultFormat, languageCodes, languageNames } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  getCachedTimezones,
  getFriendlyName,
  loadTimezones,
  type TimezoneOption,
} from "@/lib/calendar/timezone";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { SelectItem } from "@/components/ui/select";
import {
  SearchableSelect,
  type SearchableSelectOption,
} from "@/components/ui/searchable-select";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { sectionLabel, settingLabel, settingLabelId } from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import Section from "../SettingsSection";
import SettingsLabel from "../SettingsLabel";
import SyncToggle from "../SyncToggle";
import SettingsSelect from "../SettingsSelect";

const TimezonesField = memo(function TimezonesField() {
  const { t, i18n } = useTranslation();
  const { timezones, defaultTimezone, setSetting } = useCalendarSettings();
  const [allTimezones, setAllTimezones] = useState<TimezoneOption[]>(
    () => getCachedTimezones() ?? [],
  );
  useEffect(() => {
    let cancelled = false;
    loadTimezones().then((tzs) => !cancelled && setAllTimezones(tzs));
    return () => {
      cancelled = true;
    };
  }, [i18n.language]);
  const additionalTimezones = useMemo(
    () => timezones.filter((tz) => tz !== defaultTimezone),
    [timezones, defaultTimezone],
  );
  const allOptions = useMemo<SearchableSelectOption[]>(
    () =>
      allTimezones.map((tz) => ({
        value: tz.name,
        label: tz.friendlyName,
        description: tz.detail,
        searchText: tz.searchText,
      })),
    [allTimezones],
  );
  const isLimitReached = timezones.length >= MAX_CALENDAR_TIMEZONES;

  const selectDefaultTimezone = (tz: string) => {
    setSetting("defaultTimezone", tz);
    setSetting("timezones", [
      tz,
      ...additionalTimezones.filter((t) => t !== tz),
    ]);
    toast.success(t("timezone.setTo", { name: getFriendlyName(tz) }));
  };

  // swaps the promoted time zone with the current default's slot
  const promoteAdditionalTimezone = (tz: string) => {
    setSetting("defaultTimezone", tz);
    setSetting("timezones", [
      tz,
      ...additionalTimezones.map((t) => (t === tz ? defaultTimezone : t)),
    ]);
    toast.success(t("timezone.setTo", { name: getFriendlyName(tz) }));
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

  const {
    order: orderedAdditionalTimezones,
    dragIndex,
    onPointerDown,
    onKeyDown,
    setItemRef,
  } = useDragReorder(additionalTimezones, (next) =>
    setSetting("timezones", [defaultTimezone, ...next]),
  );

  const timezoneLabel = (tz: string) =>
    allTimezones.find((t) => t.name === tz)?.label ?? tz.replace(/_/g, " ");

  return (
    <FieldGroup className="mt-1 gap-5">
      <Field orientation="responsive">
        <div className="flex flex-auto items-center gap-1.5">
          <FieldTitle id="default-timezone-label" className="font-normal">
            {settingLabel("calendar-default-timezone")}
          </FieldTitle>
          <SyncToggle settingKey="defaultTimezone" />
        </div>
        <SearchableSelect
          className="w-full shrink-0 @md/field-group:w-[250px]!"
          labelledBy="default-timezone-label"
          options={allOptions}
          value={defaultTimezone}
          onValueChange={selectDefaultTimezone}
          searchPlaceholder={t("settings.calendar.tzSearch")}
        />
      </Field>

      <Field orientation="responsive">
        <FieldContent>
          <div className="flex items-center gap-1.5">
            <FieldTitle id="additional-timezones-label" className="font-normal">
              {t("settings.calendar.additionalTz")}
            </FieldTitle>
            <SyncToggle settingKey="timezones" />
          </div>
          <FieldDescription>
            {t("settings.calendar.additionalTzHelp")}
          </FieldDescription>
        </FieldContent>
        <SearchableSelect
          className="w-full shrink-0 @md/field-group:w-[250px]!"
          labelledBy="additional-timezones-label"
          options={allOptions}
          value=""
          onValueChange={addTimezone}
          disabled={isLimitReached}
          placeholder={t("settings.calendar.addTz")}
          searchPlaceholder={t("settings.calendar.tzSearch")}
        />
      </Field>

      {isLimitReached && (
        <span className="text-muted-foreground -mt-1 self-end text-xs">
          {t("settings.calendar.tzLimit", { count: MAX_CALENDAR_TIMEZONES })}
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
                aria-label={t("settings.calendar.reorderTz", {
                  name: timezoneLabel(tz),
                })}
                aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown"
                className="text-muted-foreground cursor-grab active:cursor-grabbing"
                onPointerDown={onPointerDown(index)}
                onKeyDown={onKeyDown(index)}
              >
                <GripVertical className="size-4" />
              </button>
              <span className="flex-1 text-sm">{timezoneLabel(tz)}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t("settings.calendar.setDefaultTz", {
                  name: timezoneLabel(tz),
                })}
                onClick={() => promoteAdditionalTimezone(tz)}
              >
                {t("settings.calendar.setDefault")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t("settings.calendar.remove", {
                  name: timezoneLabel(tz),
                })}
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

const weekdayName = (weekday: Weekday) => Info.weekdays("long")[weekday - 1];

// listed starting from Saturday
const WEEK_START_OPTIONS = [6, 7, 1, 2, 3, 4, 5] as const;

const FORMAT_TOKENS = [
  ["yyyy", "year"],
  ["yy", "yearShort"],
  ["MMMM", "monthLong"],
  ["MMM", "monthShort"],
  ["MM", "monthPadded"],
  ["M", "month"],
  ["dd", "dayPadded"],
  ["d", "day"],
  ["cccc", "weekdayLong"],
  ["ccc", "weekdayShort"],
  ["HH", "hour24Padded"],
  ["H", "hour24"],
  ["hh", "hour12Padded"],
  ["h", "hour12"],
  ["mm", "minutes"],
  ["a", "meridiem"],
] as const;

const FormatHelp = memo(function FormatHelp() {
  const { t } = useTranslation();
  const now = DateTime.now();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-5"
          aria-label={t("settings.formatHelp.title")}
        >
          <CircleHelp className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        className="bg-background text-foreground max-w-sm"
        arrowClassName="bg-background fill-background"
      >
        <p className="mb-1.5 font-medium">{t("settings.formatHelp.title")}</p>
        <p className="mb-2">{t("settings.formatHelp.intro")}</p>
        <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-0.5">
          {FORMAT_TOKENS.map(([token, key]) => (
            <Fragment key={token}>
              <dt className="font-mono">{token}</dt>
              <dd>{t(`settings.formatHelp.${key}`)}</dd>
              <dd className="text-end opacity-70">{now.toFormat(token)}</dd>
            </Fragment>
          ))}
        </dl>
        <p className="mt-2">{t("settings.formatHelp.literal")}</p>
      </TooltipContent>
    </Tooltip>
  );
});

const DateFormatField = memo(function DateFormatField({
  settingKey,
  formatKey,
}: {
  settingKey: "timeFormat" | "dateFormat" | "dateTimeFormat";
  formatKey: string;
}) {
  useTranslation();
  const settings = useCalendarSettings();
  const { setSetting } = settings;
  const defaultPattern = defaultFormat(
    formatKey,
    settingKey === "timeFormat" ? "" : settings.timeFormat,
  );
  const field = useDebouncedSetting(
    settings[settingKey] || defaultPattern,
    (value) => setSetting(settingKey, value === defaultPattern ? "" : value),
  );
  const pattern = field.value || defaultPattern;

  return (
    <Field orientation="responsive">
      <SettingsLabel settingKey={settingKey} onReset={field.cancel} />
      <div className="flex flex-col gap-1 @md/field-group:items-end">
        <Input
          aria-labelledby={settingLabelId(settingKey)}
          value={field.value}
          placeholder={defaultPattern}
          onChange={(e) => field.onChange(e.target.value)}
          onBlur={field.flush}
          className="w-full @md:w-[220px]"
        />
        <span className="text-muted-foreground text-xs">
          {DateTime.now().toFormat(pattern)}
        </span>
      </div>
    </Field>
  );
});

export default function RegionPage({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  const { t } = useTranslation();
  const { weekStart: resolvedWeekStart } = useWeekStart();
  const { language, weekStartsOn, setSetting } = useCalendarSettings();

  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">
        {t("settings.categories.region")}
      </h2>

      <Section
        id="language"
        label={sectionLabel("language")}
        sectionRefs={sectionRefs}
      >
        <Field orientation="responsive">
          <SettingsLabel settingKey="language" />
          <SettingsSelect
            labelledBy={settingLabelId("language")}
            value={language}
            onValueChange={(value) => setSetting("language", value)}
          >
            <SelectItem value="system">
              {t("settings.calendar.languageSystem")}
            </SelectItem>
            {languageCodes.map((code) => (
              <SelectItem key={code} value={code}>
                {languageNames[code]}
              </SelectItem>
            ))}
          </SettingsSelect>
        </Field>
      </Section>

      <Separator />

      <Section
        id="formats"
        label={sectionLabel("formats")}
        labelAddon={<FormatHelp />}
        sectionRefs={sectionRefs}
      >
        <Field orientation="responsive">
          <SettingsLabel settingKey="weekStartsOn" />
          <SettingsSelect
            labelledBy={settingLabelId("weekStartsOn")}
            value={String(weekStartsOn)}
            onValueChange={(value) =>
              setSetting(
                "weekStartsOn",
                value === "inherit" ? value : (Number(value) as Weekday),
              )
            }
            footer={
              weekStartsOn === "inherit" && (
                <span className="text-muted-foreground text-xs">
                  {t("settings.calendar.currently", {
                    day: weekdayName(resolvedWeekStart),
                  })}
                </span>
              )
            }
          >
            <SelectItem value="inherit">
              {t("settings.calendar.inherit")}
            </SelectItem>
            {WEEK_START_OPTIONS.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {weekdayName(value)}
              </SelectItem>
            ))}
          </SettingsSelect>
        </Field>

        <DateFormatField settingKey="timeFormat" formatKey="time" />
        <DateFormatField settingKey="dateFormat" formatKey="date" />
        <DateFormatField settingKey="dateTimeFormat" formatKey="dateTimeLong" />
      </Section>

      <Separator />

      <Section
        id="timezones"
        label={sectionLabel("timezones")}
        sectionRefs={sectionRefs}
      >
        <TimezonesField />
      </Section>
    </FieldGroup>
  );
}
