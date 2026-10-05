import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { useSecuritySettings } from "@/context/SecuritySettingsContext";
import { useTheme } from "@/components/ThemeProvider";
import {
  defaultCalendarSettings,
  defaultSecuritySettings,
  defaultSettings,
  defaultThemeSettings,
  type SettingKey,
} from "@/lib/settingsDefaults";

export type SettingValues = typeof defaultSettings;

export interface SettingBinding<K extends SettingKey> {
  value: SettingValues[K];
  defaultValue: SettingValues[K];
  set: (value: SettingValues[K]) => void;
}

function useCalendarSetting<K extends SettingKey>(key: K) {
  const settings = useCalendarSettings((s) => ({
    value: s[key as keyof typeof s],
    setSetting: s.setSetting,
  }));

  return {
    value: settings.value,
    set: (next: unknown) => settings.setSetting(key as never, next as never),
  };
}

function useThemeSetting(key: keyof typeof defaultThemeSettings) {
  const theme = useTheme();
  const setters = {
    theme: theme.setTheme,
    fontFamily: theme.setFontFamily,
    fontSize: theme.setFontSize,
    customCss: theme.setCustomCss,
  } as Record<string, (value: never) => void>;

  return { value: theme[key], set: setters[key] };
}

function useSecuritySetting(key: keyof typeof defaultSecuritySettings) {
  const security = useSecuritySettings();
  const setters = {
    unlockMethod: security.setUnlockMethod,
    autoLock: security.setAutoLock,
  } as Record<string, (value: never) => void>;

  return { value: security[key], set: setters[key] };
}

// key is static per call site, so the same hook runs on every render
export function useSetting<K extends SettingKey>(key: K): SettingBinding<K> {
  const useDomainSetting =
    key in defaultCalendarSettings
      ? useCalendarSetting
      : key in defaultThemeSettings
        ? useThemeSetting
        : useSecuritySetting;

  const { value, set } = (
    useDomainSetting as (key: K) => {
      value: unknown;
      set: (value: never) => void;
    }
  )(key);

  return {
    value: value as SettingValues[K],
    defaultValue: defaultSettings[key],
    set: set as SettingBinding<K>["set"],
  };
}
