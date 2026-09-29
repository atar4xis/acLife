import type { StoreSettings } from "@/lib/settingsDefaults";
import { readJSON } from "@/lib/utils";

// TODO: remove this before v1

const CALENDAR_KEY = "acl-calendar-settings";
const THEME_KEY = "ui-theme";

const LEGACY_KEYS = [
  CALENDAR_KEY,
  THEME_KEY,
  `${THEME_KEY}-colors`,
  `${THEME_KEY}-font-family`,
  `${THEME_KEY}-font-size`,
  `${THEME_KEY}-presets`,
  `${THEME_KEY}-active-preset`,
  `${THEME_KEY}-last-base`,
];

// collects values from the old per-feature localStorage keys
export function readLegacySettings(): Partial<StoreSettings> | null {
  if (!LEGACY_KEYS.some((key) => localStorage.getItem(key) !== null)) {
    return null;
  }

  const values: Record<string, unknown> = {
    ...readJSON<object | null>(CALENDAR_KEY, null),
  };

  const theme = localStorage.getItem(THEME_KEY);
  if (theme) values.theme = theme;
  const colors = readJSON<object | null>(`${THEME_KEY}-colors`, null);
  if (colors) values.colors = colors;
  const fontFamily = localStorage.getItem(`${THEME_KEY}-font-family`);
  if (fontFamily !== null) values.fontFamily = fontFamily;
  const fontSize = Number(localStorage.getItem(`${THEME_KEY}-font-size`));
  if (fontSize) values.fontSize = fontSize;
  const presets = readJSON<unknown[] | null>(`${THEME_KEY}-presets`, null);
  if (presets) values.presets = presets;
  const activePreset = localStorage.getItem(`${THEME_KEY}-active-preset`);
  if (activePreset) values.activePresetId = activePreset;
  const lastBase = localStorage.getItem(`${THEME_KEY}-last-base`);
  if (lastBase === "light" || lastBase === "dark") values.lastBase = lastBase;

  return values as Partial<StoreSettings>;
}

export function removeLegacySettings() {
  for (const key of LEGACY_KEYS) localStorage.removeItem(key);
}
