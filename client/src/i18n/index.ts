import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { Settings } from "luxon";

const bundles = import.meta.glob<{ default: Record<string, unknown> }>(
  "../locales/*.json",
  { eager: true },
);

const resources = Object.fromEntries(
  Object.entries(bundles).map(([path, mod]) => [
    path.match(/([^/]+)\.json$/)![1],
    { translation: mod.default },
  ]),
);

export const FALLBACK_LANGUAGE = "en";
export const LOCALE_CACHE = "acl-locale";
export const LOCALE_KEY = "/locale";
export const languageCodes = Object.keys(resources);
export const languageNames = Object.fromEntries(
  languageCodes.map((code) => [
    code,
    (resources[code].translation.meta as { name: string }).name,
  ]),
);

export const isLanguage = (value: unknown): value is string =>
  typeof value === "string" && languageCodes.includes(value);

function detectLanguage(): string {
  const preferred = typeof navigator === "undefined" ? [] : navigator.languages;
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    const match = languageCodes.find((code) => code.toLowerCase() === base);
    if (match) return match;
  }
  return FALLBACK_LANGUAGE;
}

export function applyLanguage(setting: unknown) {
  const language = isLanguage(setting) ? setting : detectLanguage();
  Settings.defaultLocale = language;
  document.documentElement.lang = language;
  document.documentElement.dir = i18n.dir(language);
  if (i18n.language !== language) void i18n.changeLanguage(language);
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: { escapeValue: false },
  initAsync: false,
  returnNull: false,
});

export const t = i18n.t.bind(i18n);
let formatOverrides: Record<string, string> = {};

const outsideQuotes = (pattern: string, edit: (text: string) => string) =>
  pattern
    .split(/('[^']*')/)
    .map((part, i) => (i % 2 ? part : edit(part)))
    .join("");
const withoutMeridiem = (pattern: string) =>
  outsideQuotes(pattern, (text) => text.replace(/\s*a\s*/g, " ")).trim();
const withoutMinutes = (pattern: string) =>
  outsideQuotes(pattern, (text) => text.replace(/[:.]mm/g, ""));
const is12Hour = (pattern: string) =>
  outsideQuotes(pattern, (text) => text.replace(/[^h]/g, "")) !== "";

const timeVariants: Record<string, (time: string) => string> = {
  time: (time) => time,
  timeNoMeridiem: withoutMeridiem,
  timeHour: (time) => (is12Hour(time) ? withoutMinutes(time) : time),
  timeHourNoMeridiem: (time) =>
    withoutMeridiem(is12Hour(time) ? withoutMinutes(time) : time),
};

// the language's pattern, adjusted to the user's time format
export function defaultFormat(key: string, time = formatOverrides.time) {
  const pattern = t(`fmt.${key}`);
  if (!time) return pattern;
  if (key in timeVariants) return timeVariants[key](time);

  const languageTime = t("fmt.time");
  return pattern.endsWith(languageTime)
    ? pattern.slice(0, -languageTime.length) + time
    : pattern;
}

export const fmt = (key: string) => formatOverrides[key] || defaultFormat(key);

// an empty override keeps the language's own pattern
export function applyFormats(overrides: Record<string, unknown>) {
  const next = Object.fromEntries(
    Object.entries(overrides).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1] !== "",
    ),
  );
  const same =
    Object.keys(next).length === Object.keys(formatOverrides).length &&
    Object.entries(next).every(([k, v]) => formatOverrides[k] === v);
  if (same) return;
  formatOverrides = next;
  i18n.emit("languageChanged", i18n.language);
}
export default i18n;
