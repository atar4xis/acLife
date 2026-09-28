import {
  getAllTimezones as getAllIANATimezones,
  getCountry,
  getTimezone,
} from "countries-and-timezones";
import { DateTime } from "luxon";

export interface TimezoneOption {
  name: string;
  region: string;
  label: string;
}

// zones that don't belong to a real IANA region (Etc/*, UTC, etc.)
const OTHER_REGION = "Other";

export const getDeviceTimezone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

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

export const getAllTimezones = (): TimezoneOption[] =>
  Object.keys(getAllIANATimezones())
    .filter(isValidTimezone)
    .map((name) => ({
      name,
      region: getRegion(name),
      label: `${getFriendlyName(name)} (UTC${getTimezoneOffsetLabel(name)})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

export const groupTimezonesByRegion = (
  timezones: TimezoneOption[],
): { region: string; timezones: TimezoneOption[] }[] => {
  const groups = new Map<string, TimezoneOption[]>();

  for (const tz of timezones) {
    if (!groups.has(tz.region)) groups.set(tz.region, []);
    groups.get(tz.region)!.push(tz);
  }

  return [...REGIONS, OTHER_REGION]
    .filter((region) => groups.has(region))
    .map((region) => ({ region, timezones: groups.get(region)! }));
};

export const getTimezoneHourLabel = (
  reference: DateTime,
  hour: number,
  tz: string,
): string =>
  reference
    .set({ hour, minute: 0, second: 0, millisecond: 0 })
    .setZone(tz)
    .toFormat("h a");
