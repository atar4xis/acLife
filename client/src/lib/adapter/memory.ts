import type { StorageAdapter } from "@/types/Storage";

export function memoryAdapter<T extends object>(initial: T): StorageAdapter<T> {
  let state = initial;
  return {
    load: () => state,
    save: (s) => {
      state = s;
    },
    remove() {},
    clear: () => {
      state = {} as T;
    },
  };
}
