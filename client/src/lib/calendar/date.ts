import { DateTime } from "luxon";
import { fmt, t } from "@/i18n";

export const toPickerDate = (date: DateTime) =>
  new Date(date.year, date.month - 1, date.day);

export const fromPickerDate = (date: Date) =>
  DateTime.fromObject({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });

export const isSameDate = (a: DateTime, b: DateTime) => a.hasSame(b, "day");

export const getDay = (date: DateTime) => [
  { date: date.startOf("day"), label: date.toFormat(fmt("dayShort")) },
];

export const getWeekDays = (date: DateTime, weekStartsOn: number = 1) => {
  const offset = (date.weekday - weekStartsOn + 7) % 7;
  const start = date.startOf("day").minus({ days: offset });

  return Array.from({ length: 7 }, (_, i) => {
    const day = start.plus({ days: i });
    return { date: day, label: day.toFormat(fmt("dayShort")) };
  });
};

export const getRelativeDays = (now: DateTime, days: number) => {
  const start = now.startOf("day");
  return Array.from({ length: days }, (_, i) => {
    const day = start.plus({ days: i });
    const label =
      i === 0
        ? t("date.today")
        : i === 1
          ? t("date.tomorrow")
          : day.toFormat(fmt("dayLong"));
    return { date: day, label };
  });
};

export const getMonthCells = (date: DateTime) => {
  const start = date.startOf("month").startOf("week");
  return Array.from({ length: 42 }, (_, i) => {
    const cell = start.plus({ days: i });
    return cell.month === date.month ? cell : null;
  });
};

export const getDateRangeString = (
  mode: string,
  currentDate: DateTime,
  weekStartsOn: number = 1,
) => {
  if (mode === "month") {
    return currentDate.toFormat(fmt("monthYear"));
  }

  const days =
    mode === "day"
      ? getDay(currentDate)
      : getWeekDays(currentDate, weekStartsOn);

  const first = days[0].date;
  const last = days[days.length - 1].date;

  if (first.hasSame(last, "month")) {
    return first.toFormat(fmt("monthYear"));
  }

  return `${first.toFormat(fmt("monthYearShort"))} - ${last.toFormat(fmt("monthYearShort"))}`;
};

export const timeFormat = (date: DateTime, withMeridiem = true) =>
  fmt(
    (date.minute === 0 ? "timeHour" : "time") +
      (withMeridiem ? "" : "NoMeridiem"),
  );

export const snapMinutes = (mins: number, snap: number) =>
  Math.floor(mins / snap) * snap;

export const yToMinutes = (y: number, hourHeight: number) => {
  return (y / hourHeight) * 60;
};
