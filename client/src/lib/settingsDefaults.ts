import { defaultCalendarSettings } from "@/context/CalendarSettingsContext";
import type { Theme } from "@/components/ThemeProvider";
import type { AutoLockOption, UnlockMethod } from "@/types/Storage";

export const defaultThemeSettings: {
  theme: Theme;
  fontFamily: string;
  fontSize: number;
} = {
  theme: "system",
  fontFamily: "",
  fontSize: 16,
};

export const defaultSecuritySettings: {
  unlockMethod: UnlockMethod;
  autoLock: AutoLockOption;
} = {
  unlockMethod: "password",
  autoLock: "disabled",
};

export const defaultSettings = {
  ...defaultCalendarSettings,
  ...defaultThemeSettings,
  ...defaultSecuritySettings,
};

export type SettingKey = keyof typeof defaultSettings;
