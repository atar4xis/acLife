import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { DateTime, Info } from "luxon";
import type {
  RepeatInterval,
  RepeatIntervalUnit,
} from "@/types/calendar/Event";
import { cn } from "@/lib/utils";
import { monthlyOptions, withUnitDefaults } from "@/lib/calendar/repeatOptions";
import { useWeekStart } from "@/hooks/useWeekStart";
import { toPickerDate } from "@/lib/calendar/date";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import i18n, { fmt } from "@/i18n";
import { FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { useTranslation } from "react-i18next";

// a leap year, so every date can be picked
const PICKER_YEAR = 2024;

const PICKER_CLASS_NAMES = {
  month: "flex flex-col w-full gap-1",
  month_caption: "text-center",
};

const TRUNCATING_SELECT =
  "min-w-0 flex-1 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate";

const defaultUntil = (start: DateTime) =>
  start.plus({ months: 1 }).endOf("day").toMillis();

function WeekdayToggle({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number[];
  min: number;
  max: number;
  onChange: (days: number[]) => void;
  label: string;
}) {
  const { weekStart } = useWeekStart();

  return (
    <ToggleGroup
      type="multiple"
      variant="outline"
      className="mb-1"
      aria-label={label}
      value={value.map(String)}
      onValueChange={(v) => {
        if (v.length >= min && v.length <= max) onChange(v.map(Number));
      }}
    >
      {Array.from({ length: 7 }, (_, i) => ((weekStart + i - 1) % 7) + 1).map(
        (day) => (
          <ToggleGroupItem
            key={day}
            value={String(day)}
            aria-label={Info.weekdays("long")[day - 1]}
          >
            {Info.weekdays("narrow")[day - 1]}
          </ToggleGroupItem>
        ),
      )}
    </ToggleGroup>
  );
}

function RepeatForm({
  start,
  initial,
  onApply,
  onCancel,
}: {
  start: DateTime;
  initial?: RepeatInterval;
  onApply: (repeat: RepeatInterval) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { dayPickerWeekStart } = useWeekStart();
  const [draft, setDraft] = useState<RepeatInterval>(
    initial ? withUnitDefaults(initial, start) : { interval: 1, unit: "day" },
  );
  const patch = (changes: Partial<RepeatInterval>) =>
    setDraft((d) => ({ ...d, ...changes }));
  const { unit, monthly, until, count } = draft;
  const forever = until === undefined && count === undefined;
  const [endsOpen, setEndsOpen] = useState(false);
  const untilDate = DateTime.fromMillis(until ?? 0, { zone: start.zone });

  return (
    <div className="flex min-w-0 flex-col gap-4 mt-2">
      <FieldLabel>{t("repeatDialog.every")}</FieldLabel>
      <div className="flex gap-2">
        <Input
          type="number"
          className="w-20 shrink-0"
          min={1}
          max={1000}
          aria-label={t("repeatDialog.every")}
          value={Number.isNaN(draft.interval) ? "" : draft.interval}
          onChange={(e) =>
            patch({ interval: Math.min(1000, e.target.valueAsNumber) })
          }
        />
        <Select
          value={unit}
          onValueChange={(u: RepeatIntervalUnit) =>
            setDraft((d) =>
              withUnitDefaults(
                {
                  interval: d.interval,
                  unit: u,
                  skip: d.skip,
                  until: d.until,
                  count: d.count,
                },
                start,
              ),
            )
          }
        >
          <SelectTrigger
            className={cn(TRUNCATING_SELECT, unit === "month" && "flex-none")}
            aria-label={t("repeatDialog.unit")}
          >
            <SelectValue placeholder={t("repeatDialog.unitPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">
              {t("repeatDialog.unit_day", { count: draft.interval })}
            </SelectItem>
            <SelectItem value="week">
              {t("repeatDialog.unit_week", { count: draft.interval })}
            </SelectItem>
            <SelectItem value="month">
              {t("repeatDialog.unit_month", { count: draft.interval })}
            </SelectItem>
            <SelectItem value="year">
              {t("repeatDialog.unit_year", { count: draft.interval })}
            </SelectItem>
          </SelectContent>
        </Select>
        {unit === "month" && (
          <Select
            value={monthly}
            onValueChange={(m: NonNullable<RepeatInterval["monthly"]>) =>
              patch({
                monthly: m,
                days: m === "days" ? [start.day] : undefined,
              })
            }
          >
            <SelectTrigger
              className={TRUNCATING_SELECT}
              aria-label={t("repeatDialog.monthDay")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthlyOptions(start, monthly === "last").map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
              <SelectItem value="days">
                {t("repeatDialog.specificDays")}
              </SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {unit === "day" && (
        <>
          <div className="flex gap-2">
            <Checkbox
              id="except"
              checked={draft.except !== undefined}
              onCheckedChange={(c) => patch({ except: c ? [] : undefined })}
            />
            <Label htmlFor="except">{t("repeatDialog.excluding")}</Label>
          </div>
          {draft.except && (
            <WeekdayToggle
              label={t("repeatDialog.excludedDays")}
              value={draft.except}
              min={0}
              max={6}
              onChange={(except) => patch({ except })}
            />
          )}
        </>
      )}

      {unit === "week" && (
        <>
          <FieldLabel>{t("repeatDialog.repeatOn")}</FieldLabel>
          <WeekdayToggle
            label={t("repeatDialog.repeatOn")}
            value={draft.days ?? []}
            min={1}
            max={7}
            onChange={(days) => patch({ days })}
          />
        </>
      )}

      {unit === "month" && monthly === "days" && (
        <Calendar
          mode="multiple"
          className="self-center border"
          month={new Date(PICKER_YEAR, 0)}
          hideNavigation
          hideWeekdays
          classNames={PICKER_CLASS_NAMES}
          showOutsideDays={false}
          formatters={{ formatCaption: () => t("repeatDialog.daysOfMonth") }}
          labels={{ labelGrid: () => t("repeatDialog.daysOfMonth") }}
          weekStartsOn={dayPickerWeekStart}
          selected={draft.days?.map((d) => new Date(PICKER_YEAR, 0, d))}
          onSelect={(dates) =>
            dates?.length &&
            patch({ days: dates.map((d) => d.getDate()).sort((a, b) => a - b) })
          }
        />
      )}

      {unit === "year" && (
        <>
          <div className="flex items-center gap-2">
            <Checkbox
              id="yearDays"
              checked={draft.yearDays !== undefined}
              onCheckedChange={(c) =>
                patch({ yearDays: c ? [start.toFormat("MM-dd")] : undefined })
              }
            />
            <Label htmlFor="yearDays">{t("repeatDialog.onSpecificDays")}</Label>
          </div>
          {draft.yearDays && (
            <Calendar
              mode="multiple"
              className="self-center border"
              hideWeekdays
              classNames={PICKER_CLASS_NAMES}
              defaultMonth={new Date(PICKER_YEAR, start.month - 1)}
              startMonth={new Date(PICKER_YEAR, 0)}
              endMonth={new Date(PICKER_YEAR, 11)}
              formatters={{
                formatCaption: (d) =>
                  d.toLocaleString(i18n.language, { month: "long" }),
              }}
              labels={{
                labelGrid: (d) =>
                  d.toLocaleString(i18n.language, { month: "long" }),
              }}
              weekStartsOn={dayPickerWeekStart}
              selected={draft.yearDays.map((md) => {
                const [m, d] = md.split("-").map(Number);
                return new Date(PICKER_YEAR, m - 1, d);
              })}
              onSelect={(dates) =>
                dates?.length &&
                patch({
                  yearDays: dates
                    .map((d) => DateTime.fromJSDate(d).toFormat("MM-dd"))
                    .sort(),
                })
              }
            />
          )}
        </>
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="forever"
          checked={forever}
          onCheckedChange={(c) =>
            patch({
              until: c ? undefined : defaultUntil(start),
              count: undefined,
            })
          }
        />
        <Label htmlFor="forever">{t("repeatDialog.forever")}</Label>
      </div>
      {!forever && (
        <div className="flex gap-2">
          <Select
            value={count === undefined ? "on" : "after"}
            onValueChange={(v) =>
              patch(
                v === "on"
                  ? {
                      until: defaultUntil(start),
                      count: undefined,
                    }
                  : { until: undefined, count: 10 },
              )
            }
          >
            <SelectTrigger
              className={TRUNCATING_SELECT}
              aria-label={t("repeatDialog.ends")}
            >
              <SelectValue placeholder={t("repeatDialog.ends")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="on">{t("repeatDialog.endsOn")}</SelectItem>
              <SelectItem value="after">
                {t("repeatDialog.endsAfter")}
              </SelectItem>
            </SelectContent>
          </Select>
          {count === undefined ? (
            <Popover open={endsOpen} onOpenChange={setEndsOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="flex-1 justify-start font-normal"
                  aria-label={t("repeatDialog.endsOnDate")}
                >
                  <CalendarIcon />
                  {untilDate.toFormat(fmt("date"))}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={toPickerDate(untilDate)}
                  defaultMonth={toPickerDate(untilDate)}
                  today={toPickerDate(DateTime.now())}
                  weekStartsOn={dayPickerWeekStart}
                  onSelect={(date) => {
                    if (!date) return;
                    patch({
                      until: DateTime.fromObject(
                        {
                          year: date.getFullYear(),
                          month: date.getMonth() + 1,
                          day: date.getDate(),
                        },
                        { zone: start.zone },
                      )
                        .endOf("day")
                        .toMillis(),
                    });
                    setEndsOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          ) : (
            <div className="flex flex-1 items-center gap-2">
              <Input
                type="number"
                min={1}
                max={1000}
                aria-label={t("repeatDialog.endsAfterCount")}
                value={Number.isNaN(count) ? "" : count}
                onChange={(e) =>
                  patch({
                    count: Math.min(1000, e.target.valueAsNumber),
                  })
                }
              />
              <span className="text-sm">
                {t("repeatDialog.times", { count: count ?? 0 })}
              </span>
            </div>
          )}
        </div>
      )}

      <DialogFooter className="flex-row justify-end mt-2">
        <Button variant="secondary" type="button" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          disabled={
            !Number.isInteger(draft.interval) ||
            draft.interval < 1 ||
            (count !== undefined && (!Number.isInteger(count) || count < 1))
          }
          onClick={() => onApply(draft)}
        >
          {t("common.apply")}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function RepeatDialog({
  open,
  onOpenChange,
  onCloseFocus,
  ...props
}: {
  open: boolean;
  onCloseFocus: () => void;
  onOpenChange: (open: boolean) => void;
  start: DateTime;
  initial?: RepeatInterval;
  onApply: (repeat: RepeatInterval) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby={undefined}
        onEscapeKeyDown={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onCloseFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-start">{t("editor.custom")}</DialogTitle>
        </DialogHeader>
        <RepeatForm {...props} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
