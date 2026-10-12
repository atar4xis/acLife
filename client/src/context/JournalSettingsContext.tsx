import type { JournalSettings } from "@/types/Journal";
import {
  useSettingsSelector,
  useSettingsStore,
} from "@/context/SettingsStoreContext";

type SetSetting = <K extends keyof JournalSettings>(
  key: K,
  value: JournalSettings[K],
) => void;

export interface JournalSettingsContextValue extends JournalSettings {
  setSetting: SetSetting;
  setSettings: (patch: Partial<JournalSettings>) => void;
}

const identitySelector = (value: JournalSettingsContextValue) => value;

export function useJournalSettings<T = JournalSettingsContextValue>(
  selector: (value: JournalSettingsContextValue) => T = identitySelector as (
    value: JournalSettingsContextValue,
  ) => T,
): T {
  const store = useSettingsStore();

  return useSettingsSelector(({ settings }) =>
    selector({
      ...settings,
      setSetting: store.setSetting as SetSetting,
      setSettings: store.setSettings,
    }),
  );
}
