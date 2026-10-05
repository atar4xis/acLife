import {
  useSettingsSelector,
  useSettingsStore,
} from "@/context/SettingsStoreContext";
import { isSynced, syncByDefault, type SyncableKey } from "@/lib/settingsSync";

export function useSyncSettings() {
  const store = useSettingsStore();
  const settings = useSettingsSelector(({ meta }) => ({
    enabled: meta.syncEnabled,
    overrides: meta.syncOverrides,
  }));

  return {
    enabled: settings.enabled,
    overrides: settings.overrides,
    setEnabled: store.setSyncEnabled,
    isSynced: (key: SyncableKey) => isSynced(key, settings.overrides),
    resetSynced: (keys: SyncableKey[]) =>
      store.setSyncOverrides(
        Object.fromEntries(keys.map((key) => [key, syncByDefault[key]])),
      ),
    setSynced: (keys: SyncableKey[], synced: boolean) =>
      store.setSyncOverrides(
        Object.fromEntries(keys.map((key) => [key, synced])),
      ),
  };
}
