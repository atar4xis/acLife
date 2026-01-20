import { indexedDBAdapter } from "@/lib/adapter/indexedDB";
import type { WithChildren } from "@/types/Props";
import type { StorageAdapter, StorageData } from "@/types/Storage";
import {
  createContext,
  useState,
  useMemo,
  useContext,
  useCallback,
} from "react";

interface StorageContextValue<T extends object> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
}

export function createStorageContext<T extends object>(
  adapter: StorageAdapter<T>,
) {
  const Context = createContext<StorageContextValue<T> | undefined>(undefined);

  function StorageProvider({ children }: WithChildren) {
    const [data, setData] = useState<T>(() => adapter.load());

    const get = useCallback(
      <K extends keyof T>(key: K): T[K] => {
        return data[key];
      },
      [data],
    );

    const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
      setData((prev) => {
        const next = { ...prev, [key]: value };
        adapter.save(next);
        return next;
      });
    }, []);

    const value = useMemo(() => ({ get, set }), [get, set]);

    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  const useStorage = () => useContext(Context);

  return { StorageProvider, useStorage };
}

const defaults: StorageData = {
  offlineEvents: null,
  offlineMasterKey: "",
  cachedEvents: null,
  pushSubscription: null,
  pushDismissed: false,
  sidebarOpen: true,
};

export const { StorageProvider, useStorage } =
  createStorageContext<StorageData>(
    indexedDBAdapter("acLife", "acl_data", defaults),
  );
