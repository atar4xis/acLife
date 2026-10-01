import { useSyncExternalStore } from "react";
import type { SelectionStore } from "@/lib/calendar/selection";

// re-renders only when this key's selected state flips
export const useEventSelected = (store: SelectionStore, key: string) =>
  useSyncExternalStore(store.subscribe, () => store.get().has(key));

export const useSelectedEvents = (store: SelectionStore) =>
  useSyncExternalStore(store.subscribe, store.get);
