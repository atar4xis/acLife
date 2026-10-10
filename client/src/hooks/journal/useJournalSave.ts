import { t as translate } from "@/i18n";
import { useEffect, useEffectEvent, useRef } from "react";
import { toast } from "sonner";

const SAVE_DEBOUNCE_MS = 300;

export const useJournalSave = <T>(
  value: T,
  masterKey: CryptoKey | null,
  loaded: boolean,
  save: (value: T, key: CryptoKey) => Promise<void>,
) => {
  const dirty = useRef(false);
  const flush = useEffectEvent(async (key: CryptoKey) => {
    if (!dirty.current) return;
    dirty.current = false;
    try {
      await save(value, key);
    } catch {
      toast.error(translate("journal.saveFailed"));
    }
  });

  useEffect(() => {
    if (!loaded || !masterKey) return;

    dirty.current = true;
    const timer = setTimeout(() => flush(masterKey), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, loaded, masterKey]);

  useEffect(() => {
    if (!loaded || !masterKey) return;

    return () => {
      flush(masterKey);
    };
  }, [loaded, masterKey]);
};
