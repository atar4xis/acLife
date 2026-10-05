import { Settings } from "luxon";
import { isValidTimezone } from "@/lib/calendar/timezone";
import {
  defaultCalendarSettings,
  defaultStoreSettings,
  RESYNC_INTERVAL_OPTIONS,
  type StoreKey,
  type StoreSettings,
} from "@/lib/settingsDefaults";
import { readLegacySettings, removeLegacySettings } from "@/lib/legacySettings";
import {
  syncByDefault,
  type SyncableKey,
  type SyncOverrides,
} from "@/lib/settingsSync";
import { isLanguage } from "@/i18n";
import { MAX_CUSTOM_CSS_LENGTH, MAX_PRESETS } from "@/lib/constants";
import { fitsPresetLimit } from "@/lib/themePresets";
import { readJSON, shallowEqual } from "@/lib/utils";

export const SETTINGS_STORAGE_KEY = "acl-settings";

const SCHEMA_VERSION = 1;

interface PersistedSettings {
  version: number;
  values: Partial<StoreSettings>;
  updatedAt: Partial<Record<StoreKey, number>>;
  // per-setting sync choices that differ from the setting's default
  syncOverrides: SyncOverrides;
  // master switch, when off nothing syncs but the overrides are kept
  syncEnabled: boolean;
}

export interface SettingsMeta {
  updatedAt: Partial<Record<StoreKey, number>>;
  syncOverrides: SyncOverrides;
  syncEnabled: boolean;
}

export interface SettingsStore {
  getSnapshot: () => StoreSettings;
  getMeta: () => SettingsMeta;
  subscribe: (listener: () => void) => () => void;
  setSetting: <K extends StoreKey>(key: K, value: StoreSettings[K]) => void;
  setSettings: (patch: Partial<StoreSettings>) => void;
  applyRemote: (
    patch: Partial<StoreSettings>,
    updatedAt: Partial<Record<StoreKey, number>>,
  ) => void;
  setSyncOverrides: (patch: Partial<Record<SyncableKey, boolean>>) => void;
  setSyncEnabled: (enabled: boolean) => void;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// whether a stored value has the same shape as the setting's default
function hasValidType(key: StoreKey, value: unknown): boolean {
  const fallback = defaultStoreSettings[key];

  if (key === "weekStartsOn") return true; // checked separately
  if (key === "activePresetId") {
    return value === null || typeof value === "string";
  }
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (isPlainObject(fallback)) return isPlainObject(value);
  return typeof value === typeof fallback;
}

// fills in defaults and repairs values that are missing or invalid
function normalizeSettings(stored: Record<string, unknown>): StoreSettings {
  const valid = Object.fromEntries(
    Object.entries(stored).filter(
      ([key, value]) =>
        key in defaultStoreSettings && hasValidType(key as StoreKey, value),
    ),
  );
  const parsed = { ...defaultStoreSettings, ...valid } as StoreSettings;
  const oneOf = <T>(value: T, allowed: T[], fallback: T) =>
    allowed.includes(value) ? value : fallback;

  // week start used to be stored as "mon" | "sun"
  const legacyWeekStarts: Record<string, StoreSettings["weekStartsOn"]> = {
    mon: 1,
    sun: 7,
  };
  const weekStart: unknown = stored.weekStartsOn;
  parsed.weekStartsOn =
    weekStart === "inherit" ||
    (Number.isInteger(weekStart) &&
      (weekStart as number) >= 1 &&
      (weekStart as number) <= 7)
      ? (weekStart as StoreSettings["weekStartsOn"])
      : (typeof weekStart === "string" && legacyWeekStarts[weekStart]) ||
        defaultCalendarSettings.weekStartsOn;

  parsed.defaultView = oneOf(
    parsed.defaultView,
    ["day", "week"],
    defaultCalendarSettings.defaultView,
  );
  parsed.dayHeaderPosition = oneOf(
    parsed.dayHeaderPosition,
    ["top", "bottom"],
    defaultCalendarSettings.dayHeaderPosition,
  );
  parsed.timeLabelPosition = oneOf(
    parsed.timeLabelPosition,
    ["auto", "left", "right"],
    defaultCalendarSettings.timeLabelPosition,
  );
  if (parsed.language !== "system" && !isLanguage(parsed.language)) {
    parsed.language = defaultCalendarSettings.language;
  }
  parsed.theme = oneOf(
    parsed.theme,
    ["dark", "light", "system", "custom"],
    defaultStoreSettings.theme,
  );
  parsed.lastBase = oneOf(
    parsed.lastBase,
    ["light", "dark"],
    defaultStoreSettings.lastBase,
  );

  if (!RESYNC_INTERVAL_OPTIONS.includes(parsed.resyncIntervalMinutes)) {
    parsed.resyncIntervalMinutes =
      defaultCalendarSettings.resyncIntervalMinutes;
  }
  if (!parsed.agendaRangeDays) {
    parsed.agendaRangeDays = defaultCalendarSettings.agendaRangeDays;
  }
  if (!parsed.fontSize) parsed.fontSize = defaultStoreSettings.fontSize;
  parsed.customCss = parsed.customCss.slice(0, MAX_CUSTOM_CSS_LENGTH);

  parsed.eventColorPresets = parsed.eventColorPresets.filter(
    (color) => typeof color === "string",
  );
  if (!parsed.eventColorPresets.length) {
    parsed.eventColorPresets = defaultCalendarSettings.eventColorPresets;
  }

  parsed.timezones = parsed.timezones.filter(
    (tz) => typeof tz === "string" && isValidTimezone(tz),
  );
  if (!parsed.timezones.length) {
    parsed.timezones = defaultCalendarSettings.timezones;
  }
  if (
    !parsed.defaultTimezone ||
    !isValidTimezone(parsed.defaultTimezone) ||
    !parsed.timezones.includes(parsed.defaultTimezone)
  ) {
    parsed.defaultTimezone = parsed.timezones[0];
  }
  // grid display order follows this array, so keep the default at index 0
  if (parsed.timezones[0] !== parsed.defaultTimezone) {
    parsed.timezones = [
      parsed.defaultTimezone,
      ...parsed.timezones.filter((tz) => tz !== parsed.defaultTimezone),
    ];
  }
  if (!parsed.lastSeenDeviceTimezone) {
    parsed.lastSeenDeviceTimezone =
      defaultCalendarSettings.lastSeenDeviceTimezone;
  }

  parsed.colors = Object.fromEntries(
    Object.entries(parsed.colors).filter(
      ([, color]) => typeof color === "string",
    ),
  );
  parsed.presets = parsed.presets
    .filter(
      (preset) =>
        isPlainObject(preset) &&
        typeof preset.id === "string" &&
        typeof preset.name === "string" &&
        isPlainObject(preset.colors) &&
        typeof preset.fontFamily === "string" &&
        Number.isFinite(preset.fontSize) &&
        fitsPresetLimit(preset),
    )
    .slice(0, MAX_PRESETS);

  return parsed;
}

const plainObjectOr = <T extends object>(value: unknown): T =>
  (isPlainObject(value) ? value : {}) as T;

function load(): { persisted: PersistedSettings; migrated: boolean } {
  const stored = readJSON<Partial<PersistedSettings> | null>(
    SETTINGS_STORAGE_KEY,
    null,
  );

  // TODO: remove this before v1
  const legacy = stored ? null : readLegacySettings();

  return {
    migrated: legacy !== null,
    persisted: {
      version: SCHEMA_VERSION,
      values: plainObjectOr(stored?.values ?? legacy),
      updatedAt: plainObjectOr(stored?.updatedAt),
      syncOverrides: plainObjectOr(stored?.syncOverrides),
      syncEnabled:
        typeof stored?.syncEnabled === "boolean" ? stored.syncEnabled : true,
    },
  };
}

export function createSettingsStore(): SettingsStore {
  const { persisted, migrated } = load();
  let values = normalizeSettings(persisted.values);
  let meta: SettingsMeta = {
    updatedAt: persisted.updatedAt,
    syncOverrides: persisted.syncOverrides,
    syncEnabled: persisted.syncEnabled,
  };

  const listeners = new Set<() => void>();

  const applyTimezone = () => {
    if (Settings.defaultZone.name !== values.defaultTimezone) {
      Settings.defaultZone = values.defaultTimezone;
    }
  };
  applyTimezone();

  const persist = () =>
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, values, ...meta }),
    );

  // TODO: remove this before v1
  if (migrated) {
    persist();
    removeLegacySettings();
  }

  const commit = () => {
    persist();
    listeners.forEach((listener) => listener());
  };

  const setSettings = (patch: Partial<StoreSettings>) => {
    const changed = (Object.keys(patch) as StoreKey[]).filter(
      (key) => !Object.is(values[key], patch[key]),
    );
    if (!changed.length) return;

    const now = Date.now();
    values = { ...values, ...patch };
    meta = {
      ...meta,
      updatedAt: {
        ...meta.updatedAt,
        ...Object.fromEntries(changed.map((key) => [key, now])),
      },
    };
    applyTimezone();
    commit();
  };

  return {
    getSnapshot: () => values,
    getMeta: () => meta,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSetting: (key, value) => setSettings({ [key]: value }),
    setSettings,
    applyRemote: (patch, updatedAt) => {
      const keys = (Object.keys(patch) as StoreKey[]).filter((key) =>
        hasValidType(key, patch[key]),
      );
      if (!keys.length) return;

      values = normalizeSettings({
        ...values,
        ...Object.fromEntries(keys.map((key) => [key, patch[key]])),
      });
      meta = {
        ...meta,
        updatedAt: {
          ...meta.updatedAt,
          ...Object.fromEntries(keys.map((key) => [key, updatedAt[key]])),
        },
      };
      applyTimezone();
      commit();
    },
    setSyncOverrides: (patch) => {
      const syncOverrides = { ...meta.syncOverrides };
      for (const key of Object.keys(patch) as SyncableKey[]) {
        // only choices that differ from the default are worth keeping
        if (patch[key] === syncByDefault[key]) delete syncOverrides[key];
        else syncOverrides[key] = patch[key];
      }
      if (shallowEqual(syncOverrides, meta.syncOverrides)) return;

      meta = { ...meta, syncOverrides };
      commit();
    },
    setSyncEnabled: (enabled) => {
      if (meta.syncEnabled === enabled) return;

      meta = { ...meta, syncEnabled: enabled };
      commit();
    },
  };
}
