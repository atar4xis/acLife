import { useStorage } from "@/context/StorageContext";
import { useUser } from "@/context/UserContext";
import { t as translate } from "@/i18n";
import { useJournalSave } from "@/hooks/journal/useJournalSave";
import { decryptJson, encryptJson } from "@/lib/crypt";
import { decryptJournal } from "@/lib/journal/crypt";
import { DEFAULT_JOURNAL } from "@/lib/journal/item";
import { restoreWorkspace } from "@/lib/journal/layout";
import { createJournalState } from "@/reducers/journalReducer";
import type { Encrypted } from "@/types/Crypt";
import type {
  JournalAction,
  JournalLayoutState,
  JournalState,
} from "@/types/Journal";
import {
  type Dispatch,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";

const restoreLayout = async (
  stored: Encrypted | null,
  masterKey: CryptoKey,
) => {
  if (!stored) return null;
  try {
    return await decryptJson<JournalLayoutState>(stored, masterKey);
  } catch {
    return null;
  }
};

export const useJournalPersistence = ({
  state,
  dispatch,
}: {
  state: JournalState;
  dispatch: Dispatch<JournalAction>;
}) => {
  const { masterKey, user } = useUser();
  const offline = user?.type === "offline";
  const storage = useStorage();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const read = useEffectEvent(
    (key: "journal" | "offlineJournal" | "journalLayout") => storage.get(key),
  );
  const write = useEffectEvent(
    (key: "journal" | "offlineJournal", value: null | Encrypted) =>
      storage.set(key, value),
  );
  const hydrate = useEffectEvent((next: Partial<JournalState>) =>
    dispatch({ type: "hydrate", state: next }),
  );

  useEffect(() => {
    if (!masterKey) {
      hydrate(createJournalState());
      setLoaded(false);
      setFailed(false);
      return;
    }
    if (!storage.ready) return;

    setFailed(false);

    const loadOffline = async () => {
      const stored = read("offlineJournal");
      if (stored) return decryptJournal(stored, masterKey);

      const legacy = read("journal");
      if (!legacy) return DEFAULT_JOURNAL;
      try {
        const journal = await decryptJournal(legacy, masterKey);
        write("offlineJournal", legacy);
        write("journal", null);
        return journal;
      } catch {
        return DEFAULT_JOURNAL;
      }
    };
    const loadOnline = async () => {
      const stored = read("journal");
      if (!stored) return DEFAULT_JOURNAL;
      try {
        return await decryptJournal(stored, masterKey);
      } catch {
        toast.warning(translate("journal.cacheDecryptFailed"));
        return DEFAULT_JOURNAL;
      }
    };

    let current = true;
    (async () => {
      try {
        const journal = await (offline ? loadOffline() : loadOnline());
        const layout = await restoreLayout(read("journalLayout"), masterKey);
        if (!current) return;
        hydrate({
          items: journal.items,
          sort: journal.sort,
          ...(layout && {
            workspace: restoreWorkspace(layout.workspace, (id) =>
              journal.items.some((item) => item.id === id),
            ),
            splitSizes: layout.splitSizes,
            expanded: new Set(layout.expanded),
          }),
        });
        setLoaded(true);
      } catch {
        if (!current) return;
        setFailed(true);
        toast.error(translate("journal.loadFailed"));
      }
    })();

    return () => {
      current = false;
    };
  }, [masterKey, storage.ready, offline]);

  const { items, sort, workspace, splitSizes, expanded } = state;
  const data = useMemo(() => ({ items, sort }), [items, sort]);
  const layout = useMemo(
    () => ({ workspace, splitSizes, expanded: Array.from(expanded) }),
    [workspace, splitSizes, expanded],
  );

  useJournalSave(data, masterKey, loaded, async (value, key) => {
    storage.set(
      offline ? "offlineJournal" : "journal",
      await encryptJson(value, key),
    );
  });
  useJournalSave(layout, masterKey, loaded, async (value, key) => {
    storage.set("journalLayout", await encryptJson(value, key));
  });

  return { failed, loaded };
};
