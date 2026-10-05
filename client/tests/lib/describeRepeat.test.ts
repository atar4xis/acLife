import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { describeRepeat, repeatLabel } from "../../src/lib/calendar/repeatOptions";
import type { RepeatInterval } from "../../src/types/calendar/Event";

const start = DateTime.fromISO("2026-01-02T10:00:00");
const describe_ = (repeat: RepeatInterval, from = start) =>
  describeRepeat(repeat, from);

describe("describeRepeat", () => {
  it.each<[string, RepeatInterval, string]>([
    ["month date", { interval: 2, unit: "month", monthly: "date" }, "Every 2 months on the 2nd"],
    ["month nth", { interval: 2, unit: "month", monthly: "nth" }, "Every 2 months on the first Friday"],
    ["month days", { interval: 1, unit: "month", monthly: "days", days: [9, 1, 3, 6] }, "Every month on the 1st, 3rd, 6th, and 9th"],
    ["except one", { interval: 3, unit: "day", except: [3] }, "Every 3 days except Wednesday"],
    ["except two", { interval: 3, unit: "day", except: [6, 5] }, "Every 3 days except Friday and Saturday"],
    ["except three", { interval: 3, unit: "day", except: [6, 3, 5] }, "Every 3 days except Wednesday, Friday, and Saturday"],
    ["years", { interval: 2, unit: "year" }, "Every 2 years"],
    ["year days", { interval: 2, unit: "year", yearDays: ["04-19", "01-13", "01-16", "02-19"] }, "Every 2 years on Jan 13 and 16, Feb 19, and Apr 19"],
    ["weekly days", { interval: 1, unit: "week", days: [5, 1] }, "Every week on Monday and Friday"],
    ["count", { interval: 1, unit: "day", count: 5 }, "Every day for 5 occurrences"],
    ["count of one", { interval: 1, unit: "day", count: 1 }, "Every day for 1 occurrence"],
    ["until", { interval: 1, unit: "day", until: DateTime.fromISO("2026-03-15").toMillis() }, "Every day until 15 Mar 2026"],
    ["count wins over until", { interval: 1, unit: "day", count: 2, until: DateTime.fromISO("2026-03-15").toMillis() }, "Every day for 2 occurrences"],
    ["except then until", { interval: 3, unit: "day", except: [5], until: DateTime.fromISO("2026-03-15").toMillis() }, "Every 3 days except Friday until 15 Mar 2026"],
    ["empty except", { interval: 1, unit: "day", except: [] }, "Every day"],
    ["each unit", { interval: 1, unit: "week", days: [5] }, "Every week on Friday"],
    ["month", { interval: 1, unit: "month" }, "Every month on the 2nd"],
    ["month last", { interval: 1, unit: "month", monthly: "last" }, "Every month on the last Friday"],
    ["week without days", { interval: 2, unit: "week" }, "Every 2 weeks on Friday"],
    ["year", { interval: 1, unit: "year" }, "Every year"],
    ["day", { interval: 1, unit: "day" }, "Every day"],
    ["days of a month are not listed for a date repeat", { interval: 1, unit: "month", monthly: "date", days: [1, 5] }, "Every month on the 2nd"],
    ["weekly days ignored for days unit", { interval: 2, unit: "day", days: [1] }, "Every 2 days"],
    ["year days ignored for months", { interval: 1, unit: "month", monthly: "date", yearDays: ["01-01"] }, "Every month on the 2nd"],
    ["one year day", { interval: 1, unit: "year", yearDays: ["12-25"] }, "Every year on Dec 25"],
  ])("%s", (_, repeat, text) => {
    expect(describe_(repeat)).toBe(text);
  });
});

describe("describeRepeat zones", () => {
  it("shows the until date in the start's zone", () => {
    const zoned = DateTime.fromISO("2026-01-02T10:00:00", {
      zone: "Pacific/Auckland",
    });
    const until = DateTime.fromISO("2026-03-15T00:30:00", {
      zone: "Pacific/Auckland",
    }).toMillis();

    expect(describeRepeat({ interval: 1, unit: "day", until }, zoned)).toBe(
      "Every day until 15 Mar 2026",
    );
  });
});

describe("repeatLabel", () => {
  it.each<[string, RepeatInterval, string]>([
    ["a preset", { interval: 1, unit: "day" }, "Repeat daily"],
    ["workdays", { interval: 1, unit: "day", except: [6, 7] }, "Repeat daily, except weekends"],
    ["monthly nth", { interval: 1, unit: "month", monthly: "nth" }, "Repeat monthly on the first Friday"],
    ["monthly date", { interval: 1, unit: "month", monthly: "date" }, "Repeat monthly on the 2nd"],
    ["monthly last", { interval: 1, unit: "month", monthly: "last" }, "Repeat monthly on the last Friday"],
    ["yearly", { interval: 1, unit: "year" }, "Repeat yearly"],
    ["weekly", { interval: 1, unit: "week" }, "Repeat weekly"],
    ["a custom repeat", { interval: 2, unit: "day" }, "Every 2 days"],
  ])("%s", (_, repeat, text) => {
    expect(repeatLabel(repeat, start)).toBe(text);
  });
});
