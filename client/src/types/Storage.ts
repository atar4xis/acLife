import type { Encrypted } from "./Crypt";

export interface StorageAdapter<T> {
  load(): T;
  save(state: T): void;
  remove(key: keyof T): void;
  clear(): void;
}

export interface StorageData {
  offlineEvents: Encrypted | null;
  offlineMasterKey: string;
  cachedEvents: Encrypted | null;
  pushSubscription: string | null;
  pushDismissed: boolean;
}
