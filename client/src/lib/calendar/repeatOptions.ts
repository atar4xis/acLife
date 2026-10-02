import type { DateTime } from "luxon";
import type { RepeatInterval } from "@/types/calendar/Event";

const ORDINAL_SUFFIX = {
  one: "st",
  two: "nd",
  few: "rd",
  other: "th",
} as const;
const ordinalRules = new Intl.PluralRules("en", { type: "ordinal" });
const NTH = ["first", "second", "third", "fourth", "fifth"];

const ordinal = (n: number) =>
  `${n}${ORDINAL_SUFFIX[ordinalRules.select(n) as keyof typeof ORDINAL_SUFFIX]}`;

export const monthlyOptions = (start: DateTime, keepLast = false) => {
  const options: {
    value: NonNullable<RepeatInterval["monthly"]>;
    label: string;
  }[] = [
    { value: "date", label: `on the ${ordinal(start.day)}` },
    {
      value: "nth",
      label: `on the ${NTH[Math.ceil(start.day / 7) - 1]} ${start.weekdayLong}`,
    },
  ];
  if (keepLast || start.day + 7 > start.daysInMonth!) {
    options.push({ value: "last", label: `on the last ${start.weekdayLong}` });
  }
  return options;
};

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
