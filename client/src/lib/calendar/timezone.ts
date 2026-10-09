import {
  getAllTimezones as getAllIANATimezones,
  getCountry,
  getTimezone,
} from "countries-and-timezones";
import { DateTime } from "luxon";
import i18n, { fmt, t } from "@/i18n";
import { flatMapInBatches } from "@/lib/batch";
import type { Weekday, WeekStartsOn } from "@/types/calendar/Settings";

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

// the browser's CLDR data knows country names in every language, the library only has English
const countryName = (code: string): string | undefined => {
  try {
    const localized = new Intl.DisplayNames(i18n.language, {
      type: "region",
    }).of(code);
    if (localized && localized !== code) return localized;
  } catch {
    // unsupported language or code, use the library name
  }
  return getCountry(code)?.name;
};

export const getFriendlyName = (tz: string): string => {
  const city = getTimezoneShortLabel(tz);
  const info = getTimezone(tz);
  const countryNames = (info?.countries ?? [])
    .map((code) => countryName(code))
    .filter((name): name is string => !!name);

  if (countryNames.length === 0) return city;

  const [primary, ...rest] = countryNames;
  if (rest.length > 0 && rest.length <= MAX_EXTRA_COUNTRIES_IN_LABEL) {
    return t("timezone.also", { city, primary, others: rest.join(", ") });
  }

  return `${city}, ${primary}`;
};

const getTimezoneNamePart = (
  tz: string,
  timeZoneName: "long" | "short",
): string =>
  new Intl.DateTimeFormat(i18n.language, { timeZone: tz, timeZoneName })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value ?? "";

export const getTimezoneDetail = (
  tz: string,
  offsetLabel = getTimezoneOffsetLabel(tz),
): string => {
  const offset = `UTC${offsetLabel}`;
  const long = getTimezoneNamePart(tz, "long");
  const short = getTimezoneNamePart(tz, "short");
  // intl only has real abbreviations for some zones, others fall back to GMT+9
  const abbreviation = /^(GMT|UTC)/.test(short) ? "" : ` (${short})`;
  return long ? `${long}${abbreviation}, ${offset}` : offset;
};

// matches offsets typed loosely, e.g. "+9", "utc+9", "gmt+09:00"
const getOffsetSearchTerms = (offset: string): string => {
  const sign = offset[0];
  const [hours, minutes] = offset.slice(1).split(":");
  const short = `${sign}${Number(hours)}${minutes === "00" ? "" : `:${minutes}`}`;
  return [offset, short].flatMap((o) => [o, `utc${o}`, `gmt${o}`]).join(" ");
};

const toTimezoneOption = (name: string): TimezoneOption[] => {
  if (!isValidTimezone(name)) return [];
  const friendlyName = getFriendlyName(name);
  const offset = getTimezoneOffsetLabel(name);
  return [
    {
      name,
      region: getRegion(name),
      label: `${friendlyName} (UTC${offset})`,
      friendlyName,
      detail: getTimezoneDetail(name, offset),
      searchText: `${name.replace(/_/g, " ")} ${getOffsetSearchTerms(offset)}`,
    },
  ];
};

const TIMEZONE_BATCH_SIZE = 20;
let timezonesCache: TimezoneOption[] | null = null;
let timezonesPromise: Promise<TimezoneOption[]> | null = null;

i18n.on("languageChanged", () => {
  timezonesCache = null;
  timezonesPromise = null;
});

export const getCachedTimezones = (): TimezoneOption[] | null => timezonesCache;

export const loadTimezones = (): Promise<TimezoneOption[]> => {
  timezonesPromise ??= flatMapInBatches(
    Object.keys(getAllIANATimezones()),
    toTimezoneOption,
    TIMEZONE_BATCH_SIZE,
  ).then(
    (options) =>
      (timezonesCache = options.toSorted((a, b) =>
        a.label.localeCompare(b.label),
      )),
  );
  return timezonesPromise;
};

export const getTimezoneHourLabel = (
  reference: DateTime,
  hour: number,
  tz: string,
): string =>
  reference
    .set({ hour, minute: 0, second: 0, millisecond: 0 })
    .setZone(tz)
    .toFormat(fmt("timeHour"));

const WEEK_START_COUNTRIES: string[][] = [
  [], // monday
  [],
  [],
  [],
  ["MV"], // friday
  "AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY".split(" "),
  "AG AS BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN IS JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW".split(
    " ",
  ),
];

// week data keyed by the zone's primary country
export const getTimezoneWeekStart = (tz: string): Weekday => {
  const country = getTimezone(tz)?.countries[0];
  const index = WEEK_START_COUNTRIES.findIndex(
    (countries) => country && countries.includes(country),
  );
  return (index === -1 ? 1 : index + 1) as Weekday;
};

export const resolveWeekStart = (
  setting: WeekStartsOn,
  defaultTimezone: string,
): Weekday =>
  setting === "inherit" ? getTimezoneWeekStart(defaultTimezone) : setting;
