import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
} from "react";
import { Settings } from "luxon";
import type { WithChildren } from "@/types/Props";
import type { ViewMode } from "@/types/calendar/ViewMode";
import { readJSON } from "@/lib/utils";
import { getDeviceTimezone, isValidTimezone } from "@/lib/calendar/timezone";

// iso weekday: 1 is Monday, 7 is Sunday
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type WeekStartsOn = "inherit" | Weekday;

export const MAX_EVENT_COLOR_PRESETS = 45;
export const MAX_CALENDAR_TIMEZONES = 6;
export const EVENT_COLOR_FALLBACK = "#2563eb";

export interface CalendarSettings {
  defaultView: ViewMode;
  weekStartsOn: WeekStartsOn;
  snapMinutes: number;
  defaultEventName: string;
  defaultTaskName: string;
  defaultEventDuration: number;
  resyncIntervalMinutes: number;
  agendaEnabled: boolean;
  agendaRangeDays: number;
  eventColorPresets: string[];
  addColorsAutomatically: boolean;
  timezones: string[];
  defaultTimezone: string;
  lastSeenDeviceTimezone: string;
}

const STORAGE_KEY = "acl-calendar-settings";

const deviceTimezone = getDeviceTimezone();

// eslint-disable-next-line
export const defaultCalendarSettings: CalendarSettings = {
  defaultView: "week",
  weekStartsOn: "inherit",
  snapMinutes: 5,
  defaultEventName: "new event",
  defaultTaskName: "new task",
  defaultEventDuration: 60,
  resyncIntervalMinutes: 5,
  agendaEnabled: true,
  agendaRangeDays: 3,
  eventColorPresets: [
    "#2563eb",
    "#8125ea",
    "#ea25d6",
    "#ea2528",
    "#ea7a25",
    "#eae425",
    "#2fea25",
    "#e5e5e5",
    "#141414",
  ],
  addColorsAutomatically: false,
  timezones: [deviceTimezone],
  defaultTimezone: deviceTimezone,
  lastSeenDeviceTimezone: deviceTimezone,
};

function loadSettings(): CalendarSettings {
  const stored = readJSON<Partial<CalendarSettings> | null>(
    STORAGE_KEY,
    null,
  );
  const parsed = { ...defaultCalendarSettings, ...stored };

  // week start used to be stored as "mon" | "sun"
  const legacyWeekStarts: Record<string, Weekday> = { mon: 1, sun: 7 };
  if (typeof parsed.weekStartsOn === "string" && parsed.weekStartsOn !== "inherit") {
    parsed.weekStartsOn =
      legacyWeekStarts[parsed.weekStartsOn] ??
      defaultCalendarSettings.weekStartsOn;
  }
  if (!parsed.resyncIntervalMinutes) {
    parsed.resyncIntervalMinutes =
      defaultCalendarSettings.resyncIntervalMinutes;
  }
  if (!parsed.agendaRangeDays) {
    parsed.agendaRangeDays = defaultCalendarSettings.agendaRangeDays;
  }
  if (!parsed.eventColorPresets || !parsed.eventColorPresets.length) {
    parsed.eventColorPresets = defaultCalendarSettings.eventColorPresets;
  }
  parsed.timezones = (parsed.timezones ?? []).filter(isValidTimezone);
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
    parsed.lastSeenDeviceTimezone = defaultCalendarSettings.lastSeenDeviceTimezone;
  }

  return parsed;
}

type SetSetting = <K extends keyof CalendarSettings>(
  key: K,
  value: CalendarSettings[K],
) => void;

export interface CalendarSettingsContextValue extends CalendarSettings {
  setSetting: SetSetting;
}

interface CalendarSettingsStore {
  getSnapshot: () => CalendarSettings;
  subscribe: (listener: () => void) => () => void;
  setSetting: SetSetting;
}

function createCalendarSettingsStore(): CalendarSettingsStore {
  let settings = loadSettings();
  Settings.defaultZone = settings.defaultTimezone;

  const listeners = new Set<() => void>();

  const setSetting: SetSetting = (key, value) => {
    if (Object.is(settings[key], value)) return;

    settings = { ...settings, [key]: value };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    if (Settings.defaultZone.name !== settings.defaultTimezone) {
      Settings.defaultZone = settings.defaultTimezone;
    }
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => settings,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSetting,
  };
}

function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null) return false;
  if (typeof b !== "object" || b === null) return false;

  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) return false;

  return keysA.every((key) =>
    Object.is(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

const CalendarSettingsContext = createContext<
  CalendarSettingsStore | undefined
>(undefined);

export function CalendarSettingsProvider({ children }: WithChildren) {
  const storeRef = useRef<CalendarSettingsStore | null>(null);
  if (!storeRef.current) storeRef.current = createCalendarSettingsStore();

  return (
    <CalendarSettingsContext.Provider value={storeRef.current}>
      {children}
    </CalendarSettingsContext.Provider>
  );
}

const identitySelector = (value: CalendarSettingsContextValue) => value;

// re-renders only when the selected slice changes; omit selector for the full object
// eslint-disable-next-line
export function useCalendarSettings<T = CalendarSettingsContextValue>(
  selector: (value: CalendarSettingsContextValue) => T = identitySelector as (
    value: CalendarSettingsContextValue,
  ) => T,
): T {
  const store = useContext(CalendarSettingsContext);

  if (!store)
    throw new Error(
      "useCalendarSettings must be used within a CalendarSettingsProvider",
    );

  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const cacheRef = useRef<{ input: CalendarSettings; output: T } | null>(
    null,
  );

  const getSelectedSnapshot = useCallback(() => {
    const settings = store.getSnapshot();
    const cache = cacheRef.current;
    if (cache && cache.input === settings) return cache.output;

    const output = selectorRef.current({ ...settings, setSetting: store.setSetting });
    if (cache && shallowEqual(cache.output, output)) {
      cacheRef.current = { input: settings, output: cache.output };
      return cache.output;
    }

    cacheRef.current = { input: settings, output };
    return output;
  }, [store]);

  return useSyncExternalStore(store.subscribe, getSelectedSnapshot, getSelectedSnapshot);
}
