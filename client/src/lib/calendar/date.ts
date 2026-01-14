import type { DateTime } from "luxon";

export const isSameDate = (a: DateTime, b: DateTime) => a.hasSame(b, "day");

export const getDay = (date: DateTime) => [
  { date: date.startOf("day"), label: date.toFormat("EEE d") },
];

export const getWeekDays = (date: DateTime) => {
  const start = date.startOf("week");
  return Array.from({ length: 7 }, (_, i) => {
    const day = start.plus({ days: i });
    return { date: day, label: day.toFormat("EEE d") };
  });
};

export const getMonthCells = (date: DateTime) => {
  const start = date.startOf("month").startOf("week");
  return Array.from({ length: 42 }, (_, i) => {
    const cell = start.plus({ days: i });
    return cell.month === date.month ? cell : null;
  });
};

export const getDateRangeString = (mode: string, currentDate: DateTime) => {
  if (mode === "month") {
    return currentDate.toFormat("MMMM yyyy");
  }

  const days = mode === "day" ? getDay(currentDate) : getWeekDays(currentDate);

  const first = days[0].date;
  const last = days[days.length - 1].date;

  if (first.hasSame(last, "month")) {
    return first.toFormat("MMMM yyyy");
  }

  return `${first.toFormat("MMM yyyy")} - ${last.toFormat("MMM yyyy")}`;
};

export const snapMinutes = (mins: number, snap: number) =>
  Math.floor(mins / snap) * snap;

export const yToMinutes = (y: number, hourHeight: number) => {
  return (y / hourHeight) * 60;
};
