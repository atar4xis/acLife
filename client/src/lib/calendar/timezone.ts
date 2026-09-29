import {
  getAllTimezones as getAllIANATimezones,
  getCountry,
  getTimezone,
} from "countries-and-timezones";
import { DateTime } from "luxon";
import type {
  Weekday,
  WeekStartsOn,
} from "@/context/CalendarSettingsContext";

export interface TimezoneOption {
  name: string;
  region: string;
  label: string;
  friendlyName: string;
  detail: string;
  searchText: string;
}

// zones that don't belong to a real IANA region (Etc/*, UTC, etc.)
const OTHER_REGION = "Other";

export const getDeviceTimezone = (): string => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return tz === "UTC" ? "Etc/UTC" : tz;
};

export const isValidTimezone = (tz: string): boolean =>
  DateTime.now().setZone(tz).isValid;

export const getTimezoneOffsetLabel = (tz: string): string =>
  DateTime.now().setZone(tz).toFormat("ZZ");

export const getTimezoneShortLabel = (tz: string): string =>
  tz.split("/").pop()?.replace(/_/g, " ") ?? tz;

const REGIONS = [
  "Africa",
  "America",
  "Antarctica",
  "Arctic",
  "Asia",
  "Atlantic",
  "Australia",
  "Europe",
  "Indian",
  "Pacific",
];

const getRegion = (tz: string): string => {
  const region = tz.split("/")[0];
  return REGIONS.includes(region) ? region : OTHER_REGION;
};

// some zones cover dozens of countries, so only call out a couple extra
const MAX_EXTRA_COUNTRIES_IN_LABEL = 2;

export const getFriendlyName = (tz: string): string => {
  const city = getTimezoneShortLabel(tz);
  const info = getTimezone(tz);
  const countryNames = (info?.countries ?? [])
    .map((code) => getCountry(code)?.name)
    .filter((name): name is string => !!name);

  if (countryNames.length === 0) return city;

  const [primary, ...rest] = countryNames;
  if (rest.length > 0 && rest.length <= MAX_EXTRA_COUNTRIES_IN_LABEL) {
    return `${city}, ${primary} (also ${rest.join(", ")})`;
  }

  return `${city}, ${primary}`;
};

const getTimezoneNamePart = (
  tz: string,
  timeZoneName: "long" | "short",
): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value ?? "";

export const getTimezoneDetail = (tz: string): string => {
  const offset = `UTC${getTimezoneOffsetLabel(tz)}`;
  const long = getTimezoneNamePart(tz, "long");
  const short = getTimezoneNamePart(tz, "short");
  // intl only has real abbreviations for some zones, others fall back to GMT+9
  const abbreviation = /^(GMT|UTC)/.test(short) ? "" : ` (${short})`;
  return long ? `${long}${abbreviation}, ${offset}` : offset;
};

// matches offsets typed loosely, e.g. "+9", "utc+9", "gmt+09:00"
const getOffsetSearchTerms = (tz: string): string => {
  const offset = getTimezoneOffsetLabel(tz);
  const sign = offset[0];
  const [hours, minutes] = offset.slice(1).split(":");
  const short = `${sign}${Number(hours)}${minutes === "00" ? "" : `:${minutes}`}`;
  return [offset, short].flatMap((o) => [o, `utc${o}`, `gmt${o}`]).join(" ");
};

export const getAllTimezones = (): TimezoneOption[] =>
  Object.keys(getAllIANATimezones())
    .filter(isValidTimezone)
    .map((name) => {
      const friendlyName = getFriendlyName(name);
      return {
        name,
        region: getRegion(name),
        label: `${friendlyName} (UTC${getTimezoneOffsetLabel(name)})`,
        friendlyName,
        detail: getTimezoneDetail(name),
        searchText: `${name.replace(/_/g, " ")} ${getOffsetSearchTerms(name)}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

export const getTimezoneHourLabel = (
  reference: DateTime,
  hour: number,
  tz: string,
): string =>
  reference
    .set({ hour, minute: 0, second: 0, millisecond: 0 })
    .setZone(tz)
    .toFormat("h a");

interface WeekInfoLocale {
  getWeekInfo?: () => { firstDay: number };
  weekInfo?: { firstDay: number };
}

// week start conventions from the browser's CLDR data, keyed by the zone's primary country
export const getTimezoneWeekStart = (tz: string): Weekday => {
  const country = getTimezone(tz)?.countries[0];
  if (!country) return 1;

  const locale = new Intl.Locale(`und-${country}`) as unknown as WeekInfoLocale;
  const firstDay = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
  return firstDay && firstDay >= 1 && firstDay <= 7 ? (firstDay as Weekday) : 1;
};

export const resolveWeekStart = (
  setting: WeekStartsOn,
  defaultTimezone: string,
): Weekday =>
  setting === "inherit" ? getTimezoneWeekStart(defaultTimezone) : setting;
