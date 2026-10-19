import { identity, withoutRuntimeFields } from "@/lib/utils";
import { useShares } from "@/context/ShareContext";
import { useStorage } from "@/context/StorageContext";
import { useUser } from "@/context/UserContext";
import { decryptJson, encryptJson } from "@/lib/crypt";
import { applyRemoteTo, useRecordSync } from "@/hooks/journal/useJournalSync";
import {
  admitJoined,
  admitMirrored,
  coveredItems,
  toSharedItem,
} from "@/lib/journal/shared";
import type { JournalAction, JournalItem } from "@/types/Journal";
import { mayWrite, toSharedInfo } from "@/lib/shareInfo";
import type { JoinedSpace, OwnedSpace } from "@/types/Share";
import {
  type Dispatch,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

type JournalSharingProps = {
  items: JournalItem[];
  loaded: boolean;
  dispatch: Dispatch<JournalAction>;
};

const JOINED_CACHE_SAVE_MS = 1000;

function useRestoredJoinedCache(
  space: string,
  items: JournalItem[],
  decorate: (item: JournalItem) => JournalItem,
  apply: (upserts: JournalItem[], deletedIds: string[]) => void,
) {
  const { masterKey } = useUser();
  const { ready, get, set } = useStorage();
  const [restored, setRestored] = useState(false);
  // the cached copy shows up while the first sync runs
  const restoreCachedItems = useEffectEvent((cached: JournalItem[]) =>
    apply(cached.map(decorate), []),
  );
  const readCachedItems = useEffectEvent(() => get("sharedJournals")[space]);
  const writeCachedItems = useEffectEvent(async () => {
    if (!masterKey) return;

    const encrypted = await encryptJson(
      items.map(withoutRuntimeFields),
      masterKey,
    );
    set("sharedJournals", { ...get("sharedJournals"), [space]: encrypted });
  });

  useEffect(() => {
    if (!masterKey || !ready) return;

    let cancelled = false;
    const encrypted = readCachedItems();
    (async () => {
      const cached = encrypted
        ? await decryptJson<JournalItem[]>(encrypted, masterKey).catch(() => [])
        : [];
      if (cancelled) return;

      restoreCachedItems(cached);
      setRestored(true);
    })();

    return () => {
      cancelled = true;
      setRestored(false);
    };
  }, [masterKey, ready, space]);

  useEffect(() => {
    if (!masterKey || !restored) return;

    const timer = setTimeout(writeCachedItems, JOINED_CACHE_SAVE_MS);
    return () => clearTimeout(timer);
  }, [items, restored, masterKey]);

  return restored;
}

function JoinedSync({
  space,
  items,
  loaded,
  dispatch,
}: JournalSharingProps & { space: JoinedSpace }) {
  const spaceItems = useMemo(
    () => items.filter((item) => item._shared?.space === space.id),
    [items, space.id],
  );
  const info = useMemo(() => toSharedInfo(space), [space]);
  const decorate = (item: JournalItem) => toSharedItem(item, info);

  const apply = applyRemoteTo(dispatch);
  const restored = useRestoredJoinedCache(
    space.id,
    spaceItems,
    decorate,
    apply,
  );

  useRecordSync({
    items: spaceItems,
    loaded,
    cacheRestored: restored,
    writable: mayWrite(info),
    key: space.keys.key,
    savePath: `shares/save?space=${space.id}`,
    streamType: "space-updated",
    space: space.id,
    storageFullKey: "shares.memberStorageFull",
    decorate,
    admit: (incoming) => admitJoined(items, space.id, incoming),
    apply,
  });

  return null;
}

const LAST_SYNCED_SAVE_MS = 300;

function useMirrorLastSynced(space: string) {
  const { masterKey } = useUser();
  const { ready, get, set } = useStorage();
  const [savedTimestamps, setSavedTimestamps] =
    useState<Record<string, number>>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const unsaved = useRef<Record<string, number>>(undefined);

  useEffect(() => {
    if (!masterKey || !ready) return;

    let cancelled = false;
    const stored = get("journalLastSynced")[space];
    (async () => {
      try {
        const known = stored
          ? await decryptJson<Record<string, number>>(stored, masterKey)
          : {};
        if (!cancelled) setSavedTimestamps(known);
      } catch {
        if (!cancelled) setSavedTimestamps({});
      }
    })();

    return () => {
      cancelled = true;
      setSavedTimestamps(undefined);
    };
  }, [masterKey, ready, get, space]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const known = unsaved.current;
    if (!known || !masterKey) return;

    unsaved.current = undefined;
    const encrypted = await encryptJson(known, masterKey);
    set("journalLastSynced", {
      ...get("journalLastSynced"),
      [space]: encrypted,
    });
  }, [masterKey, get, set, space]);

  useEffect(() => () => void flush(), [flush]);

  const save = useCallback(
    (known: Record<string, number>) => {
      clearTimeout(timer.current);
      unsaved.current = known;
      timer.current = setTimeout(() => void flush(), LAST_SYNCED_SAVE_MS);
    },
    [flush],
  );

  return useMemo(() => ({ savedTimestamps, save }), [savedTimestamps, save]);
}

function MirrorSync({
  space,
  items,
  loaded,
  dispatch,
}: JournalSharingProps & { space: OwnedSpace }) {
  const timestampStore = useMirrorLastSynced(space.id);
  // only the part of the journal the share covers is mirrored
  const covered = useMemo(
    () => coveredItems(items, space.target, space.scope),
    [items, space.target, space.scope],
  );

  useRecordSync({
    items: covered,
    loaded,
    writable: true,
    key: space.keys.key,
    savePath: `shares/save?space=${space.id}`,
    streamType: "space-updated",
    space: space.id,
    storageFullKey: "shares.ownerStorageFull",
    timestampStore,
    decorate: identity,
    admit: (incoming) =>
      admitMirrored(items, space.target, space.scope, incoming),
    apply: applyRemoteTo(dispatch),
  });

  return null;
}

export default function JournalSharing({
  removed,
  ...props
}: JournalSharingProps & { removed: string[] }) {
  const { joined, owned, deleteSpace } = useShares();
  const { dispatch, loaded } = props;
  const journals = useMemo(
    () => joined.filter((space) => space.kind === "journal"),
    [joined],
  );

  useEffect(() => {
    if (loaded)
      dispatch({ type: "setSharedSpaces", spaces: journals.map(toSharedInfo) });
  }, [loaded, journals, dispatch]);

  // sharing a note ends once the note itself is deleted
  const endDeletedShares = useEffectEvent(() => {
    for (const space of owned) {
      const deleted = space.target !== null && removed.includes(space.target);
      if (space.kind === "journal" && deleted) deleteSpace(space.id);
    }
  });

  useEffect(() => {
    if (removed.length > 0) endDeletedShares();
  }, [removed]);

  return (
    <>
      {journals.map((space) => (
        <JoinedSync key={space.id} space={space} {...props} />
      ))}
      {owned
        .filter((space) => space.kind === "journal")
        .map((space) => (
          <MirrorSync key={space.id} space={space} {...props} />
        ))}
    </>
  );
}
