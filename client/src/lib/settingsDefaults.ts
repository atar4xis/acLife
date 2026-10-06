import type { CalendarSettings } from "@/types/calendar/Settings";
import type { Theme, ThemeColors, ThemePreset } from "@/types/Theme";
import type { AutoLockOption, UnlockMethod } from "@/types/Storage";
import { getDeviceTimezone } from "@/lib/calendar/timezone";

const deviceTimezone = getDeviceTimezone();

export const RESYNC_INTERVAL_OPTIONS = [5, 15, 30];

export const defaultCalendarSettings: CalendarSettings = {
  language: "system",
  defaultView: "week",
  weekStartsOn: "inherit",
  timeFormat: "",
  dateFormat: "",
  dateTimeFormat: "",
  snapMinutes: 5,
  lineOpacity: 10,
  dayHeaderPosition: "top",
  timeLabelPosition: "auto",
  defaultEventName: "new event",
  defaultTaskName: "new task",
  defaultEventDuration: 60,
  resyncIntervalMinutes: 15,
  agendaEnabled: true,
  agendaRangeDays: 3,
  showOverdueTasks: true,
  overdueDays: 3,
  miniCalendarEnabled: true,
  miniCalendarEventBars: false,
  miniCalendarWeekNumbers: false,
  miniCalendarBoldDayNumbers: false,
  miniCalendarAdaptiveNumbers: false,
  miniCalendarDropdowns: false,
  detachRecurringOnEdit: false,
  eventClickAction: "details",
  eventDoubleClickAction: "edit",
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
  followCurrentTime: true,
  autoCheckUpdates: false,
  autoInstallUpdates: false,
  updateChannel: __APP_VERSION__.includes("-") ? "beta" : "stable",
  eventEditorOpacity: 80,
  eventEditorBlur: 10,
  eventEditorRadius: 10,
  timezones: [deviceTimezone],
  defaultTimezone: deviceTimezone,
  lastSeenDeviceTimezone: deviceTimezone,
};

export const defaultThemeSettings: {
  theme: Theme;
  fontFamily: string;
  fontSize: number;
  customCss: string;
} = {
  theme: "system",
  fontFamily: "",
  fontSize: 16,
  customCss: "",
};

export const defaultSecuritySettings: {
  unlockMethod: UnlockMethod;
  autoLock: AutoLockOption;
} = {
  unlockMethod: "password",
  autoLock: "disabled",
};

// everything persisted by the settings store
export const defaultStoreSettings = {
  ...defaultCalendarSettings,
  ...defaultThemeSettings,
  colors: {} as ThemeColors,
  presets: [] as ThemePreset[],
  activePresetId: null as string | null,
  lastBase: "light" as "light" | "dark",
};

export type StoreSettings = typeof defaultStoreSettings;
export type StoreKey = keyof StoreSettings;

// everything that has a control in the settings dialog
export const defaultSettings = {
  ...defaultCalendarSettings,
  ...defaultThemeSettings,
  ...defaultSecuritySettings,
};

export type SettingKey = keyof typeof defaultSettings;
