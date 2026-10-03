import type { DateTime } from "luxon";
import { t } from "@/i18n";
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
