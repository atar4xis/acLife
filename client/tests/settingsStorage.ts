import type { StoreSettings } from "../src/lib/settingsDefaults.ts";
import { SETTINGS_STORAGE_KEY } from "../src/lib/settingsStore.ts";

// writes settings the way the store persists them, so tests can start from a given state
export const seedSettings = (values: Partial<StoreSettings> | object) =>
  localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({ version: 1, values, updatedAt: {}, syncOverrides: {} }),
  );

const readStored = () =>
  JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null");

export const readSettings = (): StoreSettings => readStored().values;
export const readSettingsMeta = () => readStored();
