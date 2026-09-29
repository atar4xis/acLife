import type { CalendarSettings } from "@/types/calendar/Settings";
import {
  useSettingsSelector,
  useSettingsStore,
} from "@/context/SettingsStoreContext";

export const MAX_EVENT_COLOR_PRESETS = 45;
export const MAX_CALENDAR_TIMEZONES = 6;
export const EVENT_COLOR_FALLBACK = "#2563eb";

type SetSetting = <K extends keyof CalendarSettings>(
  key: K,
  value: CalendarSettings[K],
) => void;

export interface CalendarSettingsContextValue extends CalendarSettings {
  setSetting: SetSetting;
}

const identitySelector = (value: CalendarSettingsContextValue) => value;

// re-renders only when the selected slice changes; omit selector for the full object
export function useCalendarSettings<T = CalendarSettingsContextValue>(
  selector: (value: CalendarSettingsContextValue) => T = identitySelector as (
    value: CalendarSettingsContextValue,
  ) => T,
): T {
  const store = useSettingsStore();

  return useSettingsSelector(({ settings }) =>
    selector({ ...settings, setSetting: store.setSetting as SetSetting }),
  );
}
