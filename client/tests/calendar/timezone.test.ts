import { afterEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { getAllTimezones as getAllIANATimezones } from "countries-and-timezones";
import {
  loadTimezones,
  getDeviceTimezone,
  getFriendlyName,
  getTimezoneHourLabel,
  getTimezoneOffsetLabel,
  getTimezoneShortLabel,
  getTimezoneWeekStart,
  resolveWeekStart,
} from "../../src/lib/calendar/timezone.ts";

describe("getDeviceTimezone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the time zone from Intl.DateTimeFormat", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ timeZone: "Asia/Tokyo" }),
        }) as unknown as Intl.DateTimeFormat,
    );

    expect(getDeviceTimezone()).toBe("Asia/Tokyo");
  });
});

describe("getTimezoneOffsetLabel", () => {
  it("formats a zone with no DST using its fixed offset", () => {
    expect(getTimezoneOffsetLabel("Asia/Tokyo")).toBe("+09:00");
    expect(getTimezoneOffsetLabel("UTC")).toBe("+00:00");
  });
});

describe("getTimezoneShortLabel", () => {
  it("uses the city segment of the IANA name", () => {
    expect(getTimezoneShortLabel("America/New_York")).toBe("New York");
    expect(getTimezoneShortLabel("Asia/Tokyo")).toBe("Tokyo");
  });

  it("falls back to the whole name when there is no city segment", () => {
    expect(getTimezoneShortLabel("UTC")).toBe("UTC");
  });
});

describe("getFriendlyName", () => {
  it("combines the city and country when the zone maps to a single country", () => {
    expect(getFriendlyName("Asia/Dubai")).toBe("Dubai, United Arab Emirates");
  });

  it("falls back to just the city when the zone has no country", () => {
    expect(getFriendlyName("Etc/GMT+5")).toBe("GMT+5");
  });

  it("calls out a couple of extra countries sharing the same zone, e.g. Amsterdam under Brussels", () => {
    // Amsterdam has no IANA zone of its own; it's a deprecated alias of Europe/Brussels
    expect(getFriendlyName("Europe/Brussels")).toBe(
      "Brussels, Belgium (also Luxembourg, Netherlands)",
    );
  });

  it("falls back to just the primary country when there are too many to list", () => {
    expect(getFriendlyName("America/Puerto_Rico")).toBe(
      "Puerto Rico, Puerto Rico",
    );
  });
});

describe("loadTimezones", () => {
  it("includes every IANA time zone that resolves to a valid offset", async () => {
    const expectedCount = Object.keys(getAllIANATimezones()).filter(
      (name) => DateTime.now().setZone(name).isValid,
    ).length;
    expect(await loadTimezones()).toHaveLength(expectedCount);
  });

  it("excludes zones the runtime can't resolve to a valid offset, like Factory", async () => {
    expect(
      (await loadTimezones()).find((tz) => tz.name === "Factory"),
    ).toBeUndefined();
  });

  it("builds a friendly, offset-suffixed label and assigns a region", async () => {
    const dubai = (await loadTimezones()).find(
      (tz) => tz.name === "Asia/Dubai",
    );

    expect(dubai).toMatchObject({
      name: "Asia/Dubai",
      region: "Asia",
      label: "Dubai, United Arab Emirates (UTC+04:00)",
      friendlyName: "Dubai, United Arab Emirates",
    });
    expect(dubai?.detail).toBe("Gulf Standard Time, UTC+04:00");
  });

  it("buckets zones with no real region under Other", async () => {
    const etcUtc = (await loadTimezones()).find((tz) => tz.name === "Etc/UTC");
    expect(etcUtc?.region).toBe("Other");
  });

  it("sorts the results alphabetically by label", async () => {
    const labels = (await loadTimezones()).map((tz) => tz.label);
    const sorted = [...labels].sort((a, b) => a.localeCompare(b));
    expect(labels).toEqual(sorted);
  });
});

describe("getTimezoneWeekStart", () => {
  it("uses Monday for countries that start the week on Monday", () => {
    expect(getTimezoneWeekStart("Europe/Dublin")).toBe(1);
  });

  it("uses Sunday for countries that start the week on Sunday", () => {
    expect(getTimezoneWeekStart("America/New_York")).toBe(7);
  });

  it("falls back to Monday for zones without a country", () => {
    expect(getTimezoneWeekStart("Etc/UTC")).toBe(1);
  });
});

describe("resolveWeekStart", () => {
  it("returns explicit settings unchanged", () => {
    expect(resolveWeekStart(7, "Europe/Dublin")).toBe(7);
    expect(resolveWeekStart(1, "America/New_York")).toBe(1);
  });

  it("follows the default time zone when set to inherit", () => {
    expect(resolveWeekStart("inherit", "Europe/Dublin")).toBe(1);
    expect(resolveWeekStart("inherit", "America/New_York")).toBe(7);
  });
});

describe("getTimezoneHourLabel", () => {
  it("converts the given hour on the reference date into the target zone", () => {
    const reference = DateTime.fromISO("2026-03-18T00:00:00", { zone: "UTC" });

    expect(getTimezoneHourLabel(reference, 12, "UTC")).toBe("12 PM");
    expect(getTimezoneHourLabel(reference, 12, "Asia/Tokyo")).toBe("9 PM");
  });

  it("wraps across midnight when the target zone is behind", () => {
    const reference = DateTime.fromISO("2026-03-18T00:00:00", { zone: "UTC" });

    // 1 AM UTC is still the previous day at 9 PM in New York (EDT, UTC-4)
    expect(getTimezoneHourLabel(reference, 1, "America/New_York")).toBe("9 PM");
  });
});
