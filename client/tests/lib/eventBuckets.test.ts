import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  MAX_SERIES_BUCKETS,
  RECURRING_BUCKET_LABEL,
  eventBucketLabels,
  weekLabel,
} from "../../src/lib/calendar/buckets.ts";
import type { RepeatInterval } from "../../src/types/calendar/Event.ts";

const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });
const series = (repeat: RepeatInterval, start = "2026-03-09T09:00", hours = 1) => ({
  start: at(start),
  end: at(start).plus({ hours }),
  repeat,
});

describe("eventBucketLabels", () => {
  it("labels weeks in UTC regardless of the event zone", () => {
    const utc = at("2026-09-27T16:00");
    const tokyo = utc.setZone("Asia/Tokyo");
    expect(tokyo.weekNumber).not.toBe(utc.weekNumber);
    expect(
      eventBucketLabels({ start: tokyo, end: tokyo.plus({ hours: 1 }) }),
    ).toEqual(["2026-W39"]);
  });

  it("leaves one-off events in their own weeks", () => {
    const start = at("2026-03-08T23:00");
    expect(
      eventBucketLabels({ start, end: start.plus({ hours: 2 }) }),
    ).toEqual([weekLabel(start), weekLabel(start.plus({ hours: 2 }))]);
  });

  it("keeps unbounded series in the recurring bucket", () => {
    expect(eventBucketLabels(series({ interval: 1, unit: "week" }))).toEqual([
      "2026-W11",
      RECURRING_BUCKET_LABEL,
    ]);
  });

  it("buckets a short bounded series by week only", () => {
    const until = at("2026-03-25T00:00").toMillis();
    expect(
      eventBucketLabels(series({ interval: 1, unit: "week", until })),
    ).toEqual(["2026-W11", "2026-W12", "2026-W13"]);
  });

  it("buckets a counted series by week only", () => {
    expect(
      eventBucketLabels(series({ interval: 1, unit: "week", count: 3 })),
    ).toEqual(["2026-W11", "2026-W12", "2026-W13"]);
  });

  it("switches to the recurring bucket at the series bucket cap", () => {
    const weekly = (count: number) =>
      eventBucketLabels(series({ interval: 1, unit: "week", count }));

    expect(weekly(MAX_SERIES_BUCKETS - 1)).toHaveLength(MAX_SERIES_BUCKETS - 1);
    expect(weekly(MAX_SERIES_BUCKETS)).toEqual(["2026-W11", RECURRING_BUCKET_LABEL]);
  });

  it("only buckets the weeks that hold an occurrence", () => {
    expect(
      eventBucketLabels(
        series({ interval: 1, unit: "year", count: 3, yearDays: ["03-09"] }),
      ),
    ).toEqual(["2026-W11", "2027-W10", "2028-W10"]);
  });

  it("includes every week a multi-day occurrence spans", () => {
    expect(
      eventBucketLabels(series({ interval: 2, unit: "week", count: 2 }, "2026-03-15T20:00", 6)),
    ).toEqual(["2026-W11", "2026-W12", "2026-W13", "2026-W14"]);
  });

  it("drops weeks whose occurrences are skipped or excluded", () => {
    expect(
      eventBucketLabels(
        series({ interval: 1, unit: "week", count: 3, skip: ["2026-03-16"] }),
      ),
    ).toEqual(["2026-W11", "2026-W13", "2026-W14"]);
  });
});
