import type { Encrypted } from "./Crypt";

type MaybePromise<T> = T | Promise<T>;

export interface StorageAdapter<T extends object> {
  load(): MaybePromise<T>;
  save(state: T): MaybePromise<void>;
  remove(key: keyof T): MaybePromise<void>;
  clear(): MaybePromise<void>;
}

export type UnlockMethod = "password" | "pin" | "stay-unlocked";

export type AutoLockOption =
  | "disabled"
  | "focus"
  | "5m"
  | "10m"
  | "15m"
  | "30m"
  | "45m"
  | "1h";

export interface WrappedKeyPair {
  salt: string;
  encrypted: string;
}

export interface RawKeyPair {
  masterKeyB64: string;
  bucketKeyB64: string;
}

export interface StorageData {
  offlineEvents: Encrypted | null;
  offlineMasterKey: string;
  cachedEvents: Encrypted | null;
  pushSubscription: string | null;
  pushDismissed: boolean;
  sidebarOpen: boolean;
  sidebarWidth: string | null;
  unlockMethod: UnlockMethod;
  unlockKeys: RawKeyPair | null;
  pinWrappedKeys: WrappedKeyPair | null;
  autoLock: AutoLockOption;
}
