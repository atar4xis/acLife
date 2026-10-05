import { DateTime, Info } from "luxon";
import i18n, { fmt, t } from "@/i18n";
import type { RepeatInterval } from "@/types/calendar/Event";

const NTH = ["first", "second", "third", "fourth", "fifth"];

export const monthlyOptions = (start: DateTime, keepLast = false) => {
  const options: {
    value: NonNullable<RepeatInterval["monthly"]>;
    label: string;
  }[] = [
    {
      value: "date",
      label: t("repeat.onDate", { count: start.day, ordinal: true }),
    },
    {
      value: "nth",
      label: t("repeat.onNth", {
        nth: t(`repeat.nth.${NTH[Math.ceil(start.day / 7) - 1]}`),
        weekday: start.weekdayLong,
      }),
    },
  ];
  if (keepLast || start.day + 7 > start.daysInMonth!) {
    options.push({
      value: "last",
      label: t("repeat.onLast", { weekday: start.weekdayLong }),
    });
  }
  return options;
};

export const repeatKey = (r: RepeatInterval) =>
  JSON.stringify([
    r.interval,
    r.unit,
    r.except,
    r.monthly,
    r.days,
    r.yearDays,
    r.until,
    r.count,
  ]);

export const withUnitDefaults = (
  repeat: RepeatInterval,
  start?: DateTime,
): RepeatInterval => {
  if (repeat.unit === "month" && !repeat.monthly) {
    return { ...repeat, monthly: "date" };
  }
  if (repeat.unit === "week" && !repeat.days && start) {
    return { ...repeat, days: [start.weekday] };
  }
  return repeat;
};

export const repeatChanged = (a?: RepeatInterval, b?: RepeatInterval) =>
  (a && repeatKey(withUnitDefaults(a))) !==
  (b && repeatKey(withUnitDefaults(b)));

// TODO: make these configurable
export const presetRepeat: Record<string, RepeatInterval> = {
  daily: { interval: 1, unit: "day" },
  weekly: { interval: 1, unit: "week" },
  workdays: { interval: 1, unit: "day", except: [6, 7] },
  "monthly-date": { interval: 1, unit: "month", monthly: "date" },
  "monthly-nth": { interval: 1, unit: "month", monthly: "nth" },
  "monthly-last": { interval: 1, unit: "month", monthly: "last" },
  yearly: { interval: 1, unit: "year" },
};

export const parseRepeatValue = (value: RepeatInterval) => {
  const key = repeatKey(withUnitDefaults(value));
  return (
    Object.entries(presetRepeat).find(
      ([, preset]) => repeatKey(preset) === key,
    )?.[0] ?? "custom"
  );
};

const list = (items: string[]) =>
  new Intl.ListFormat(i18n.language).format(items);

const weekdayNames = (days: number[]) =>
  list(days.toSorted((a, b) => a - b).map((d) => Info.weekdays("long")[d - 1]));

const yearDates = (yearDays: string[]) => {
  const byMonth = new Map<number, string[]>();
  for (const md of yearDays.toSorted()) {
    const [month, day] = md.split("-").map(Number);
    byMonth.set(month, [...(byMonth.get(month) ?? []), String(day)]);
  }
  return list(
    [...byMonth].map(([month, days]) =>
      t("repeatText.monthDays", {
        month: Info.months("short")[month - 1],
        days: list(days),
      }),
    ),
  );
};

const repeatOn = (repeat: RepeatInterval, start: DateTime) => {
  if (repeat.unit === "week" && repeat.days)
    return t("repeatText.on", { list: weekdayNames(repeat.days) });
  if (repeat.unit === "year" && repeat.yearDays)
    return t("repeatText.on", { list: yearDates(repeat.yearDays) });
  if (repeat.unit !== "month") return;
  if (repeat.monthly === "days" && repeat.days) {
    const days = repeat.days
      .toSorted((a, b) => a - b)
      .map((count) => t("repeatText.dayOrdinal", { count, ordinal: true }));
    return t("repeatText.onDays", { days: list(days) });
  }
  return monthlyOptions(start, true).find((o) => o.value === repeat.monthly)
    ?.label;
};

export const describeRepeat = (repeat: RepeatInterval, start: DateTime) => {
  const r = withUnitDefaults(repeat, start);
  const ends =
    r.count !== undefined
      ? t("repeatText.times", { count: r.count })
      : r.until !== undefined &&
        t("repeatText.until", {
          date: DateTime.fromMillis(r.until, { zone: start.zone }).toFormat(
            fmt("date"),
          ),
        });
  return [
    r.interval === 1
      ? t(`repeatText.every.${r.unit}`)
      : t(`repeatText.everyN.${r.unit}`, { count: r.interval }),
    repeatOn(r, start),
    r.except?.length &&
      t("repeatText.except", { days: weekdayNames(r.except) }),
    ends,
  ]
    .filter(Boolean)
    .join(" ");
};

export const repeatLabel = (repeat: RepeatInterval, start: DateTime) => {
  const value = parseRepeatValue(repeat);
  if (value === "custom") return describeRepeat(repeat, start);
  if (!value.startsWith("monthly-")) return t(`editor.${value}`);
  const option = monthlyOptions(start, repeat.monthly === "last").find(
    (o) => `monthly-${o.value}` === value,
  );
  return t("editor.monthly", { option: option?.label });
};
