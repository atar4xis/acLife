import { useSyncExternalStore } from "react";
import type { GridFocusStore } from "@/lib/calendar/gridFocus";

export const useEventFocused = (
  store: GridFocusStore,
  key: string,
  day: number,
) =>
  useSyncExternalStore(store.subscribe, () => {
    const focus = store.getFocus();
    return focus?.eventKey === key && focus.day === day;
  });

export const useDayFocus = (store: GridFocusStore, day: number) =>
  useSyncExternalStore(store.subscribe, () => {
    const focus = store.getFocus();
    return focus?.day === day ? focus : null;
  });

export const useKeyboardMode = (store: GridFocusStore) =>
  useSyncExternalStore(store.subscribe, store.getKeyboardMode);

export const useDaySpoken = (store: GridFocusStore, day: number) =>
  useSyncExternalStore(store.subscribe, () => {
    const move = store.getSpoken();
    return move?.day === day ? move : null;
  });

export const useSpokenActive = (store: GridFocusStore) =>
  useSyncExternalStore(store.subscribe, () => store.getSpoken() !== null);
