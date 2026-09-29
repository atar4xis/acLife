import { indexedDBAdapter } from "@/lib/adapter/indexedDB";
import { defaultSecuritySettings } from "@/lib/settingsDefaults";
import type { WithChildren } from "@/types/Props";
import type { StorageAdapter, StorageData } from "@/types/Storage";
import {
  createContext,
  useState,
  useMemo,
  useContext,
  useCallback,
  useEffect,
  useRef,
} from "react";

interface StorageContextValue<T extends object> {
  ready: boolean;
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
}

export function createStorageContext<T extends object>(
  adapter: StorageAdapter<T>,
  defaults: T,
) {
  const Context = createContext<StorageContextValue<T> | undefined>(undefined);

  function StorageProvider({ children }: WithChildren) {
    const [data, setData] = useState<T>(defaults);
    const [ready, setReady] = useState(false);
    const dataRef = useRef(data);
    dataRef.current = data;

    useEffect(() => {
      let cancelled = false;

      Promise.resolve(adapter.load())
        .then((loaded) => {
          if (!cancelled) {
            dataRef.current = loaded;
            setData(loaded);
          }
        })
        .catch((error) => {
          console.error("Failed to load storage data:", error);
        })
        .finally(() => {
          if (!cancelled) setReady(true);
        });

      return () => {
        cancelled = true;
      };
    }, []);

    const get = useCallback(
      <K extends keyof T>(key: K): T[K] => dataRef.current[key],
      [],
    );

    const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
      setData((prev) => {
        const next = { ...prev, [key]: value };
        dataRef.current = next;

        Promise.resolve(adapter.save(next)).catch((error) => {
          console.error("Failed to save storage data:", error);
        });

        return next;
      });
    }, []);

    const value = useMemo(
      () => ({ ready, get, set }),
      // data included to always have the latest values
      // eslint-disable-next-line
      [ready, get, set, data],
    );

    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  const useStorage = () => {
    const context = useContext(Context);

    if (!context) {
      throw new Error("useStorage must be used within a StorageProvider");
    }

    return context;
  };

  return { StorageProvider, useStorage };
}

const defaults: StorageData = {
  offlineEvents: null,
  offlineMasterKey: "",
  cachedEvents: null,
  pushSubscription: null,
  pushDismissed: false,
  sidebarOpen: true,
  ...defaultSecuritySettings,
  unlockKeys: null,
  pinWrappedKeys: null,
};

export const { StorageProvider, useStorage } =
  createStorageContext<StorageData>(
    indexedDBAdapter("acLife", "acl_data", defaults),
    defaults,
  );
