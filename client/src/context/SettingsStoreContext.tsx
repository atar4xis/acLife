import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
} from "react";
import type { WithChildren } from "@/types/Props";
import { shallowEqual } from "@/lib/utils";
import type { StoreSettings } from "@/lib/settingsDefaults";
import {
  createSettingsStore,
  type SettingsMeta,
  type SettingsStore,
} from "@/lib/settingsStore";

const SettingsStoreContext = createContext<SettingsStore | undefined>(
  undefined,
);

export function SettingsStoreProvider({ children }: WithChildren) {
  const storeRef = useRef<SettingsStore | null>(null);
  if (!storeRef.current) storeRef.current = createSettingsStore();

  return (
    <SettingsStoreContext.Provider value={storeRef.current}>
      {children}
    </SettingsStoreContext.Provider>
  );
}

// eslint-disable-next-line
export function useSettingsStore() {
  const store = useContext(SettingsStoreContext);
  if (!store)
    throw new Error(
      "useSettingsStore must be used within a SettingsStoreProvider",
    );
  return store;
}

export interface SettingsState {
  settings: StoreSettings;
  meta: SettingsMeta;
}

// re-renders only when the selected slice of the settings or sync state changes
// eslint-disable-next-line
export function useSettingsSelector<T>(
  selector: (state: SettingsState) => T,
): T {
  const store = useSettingsStore();
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const cacheRef = useRef<(SettingsState & { output: T }) | null>(null);

  const getSelectedSnapshot = useCallback(() => {
    const settings = store.getSnapshot();
    const meta = store.getMeta();
    const cache = cacheRef.current;
    if (cache && cache.settings === settings && cache.meta === meta) {
      return cache.output;
    }

    const output = selectorRef.current({ settings, meta });
    // keep the previous reference when nothing in the slice changed
    const stable =
      cache && shallowEqual(cache.output, output) ? cache.output : output;
    cacheRef.current = { settings, meta, output: stable };
    return stable;
  }, [store]);

  return useSyncExternalStore(
    store.subscribe,
    getSelectedSnapshot,
    getSelectedSnapshot,
  );
}
