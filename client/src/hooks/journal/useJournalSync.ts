import { useApi } from "@/context/ApiContext";
import { useUser } from "@/context/UserContext";
import { t } from "@/i18n";
import { computeBucketHash } from "@/lib/bucketHash";
import { withClient } from "@/lib/clientId";
import {
  decryptItem,
  encryptItem,
  MAX_ENCRYPTED_JOURNAL_BYTES,
} from "@/lib/journal/crypt";
import {
  CHUNK_ITEMS,
  diffBuckets,
  journalBucket,
  journalLinesTable,
  journalLines,
  mergeRemote,
  pendingChanges,
} from "@/lib/journal/sync";
import { createCoalescer, createSerialQueue } from "@/lib/serialQueue";
import { syncPart } from "@/lib/syncBatch";
import { isOwnMessage, onStream, type StreamMessage } from "@/lib/stream";
import { isSubscriptionMissing } from "@/lib/subscription";
import { base64ByteLength, identity } from "@/lib/utils";
import type { EncryptedRecord, RecordChange } from "@/types/Sync";
import type {
  JournalAction,
  JournalHashResponse,
  JournalItem,
  JournalSyncResponse,
} from "@/types/Journal";
import {
  type Dispatch,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

const SAVE_DELAY_MS = 1000;
const SYNC_BUCKETS = 16;

const isPresent = <T>(value: T | null): value is T => value !== null;

type ItemStamp = { id: string; ts: number };

type PendingChanges = {
  upserts: JournalItem[];
  deletedIds: string[];
  ids: Set<string>;
};

type SyncState = {
  reset: (
    items: JournalItem[],
    savedTimestamps?: Record<string, number>,
  ) => void;
  pending: (items: JournalItem[]) => PendingChanges;
  hashLines: (items: JournalItem[]) => ItemStamp[];
  has: (id: string) => boolean;
  markSynced: (item: JournalItem) => void;
  noteRemoteTimestamp?: (item: JournalItem) => void;
  dropIds: (ids: string[]) => void;
  snapshot?: () => Record<string, number>;
};

// own items are compared by identity with the last acknowledged copy
const itemSyncState = (acked: Map<string, JournalItem>): SyncState => ({
  reset: (items) => {
    acked.clear();
    for (const item of items) acked.set(item.id, item);
  },
  pending: (items) => pendingChanges(items, acked),
  hashLines: journalLines,
  has: (id) => acked.has(id),
  markSynced: (item) => void acked.set(item.id, item),
  dropIds: (ids) => ids.forEach((id) => acked.delete(id)),
});

// mirrored spaces only track the last known timestamp per id, persisted across restarts
const timestampSyncState = (known: Map<string, number>): SyncState => ({
  reset: (_, savedTimestamps = {}) => {
    known.clear();
    for (const [id, ts] of Object.entries(savedTimestamps)) known.set(id, ts);
  },
  pending: (items) => {
    const upserts = items.filter(
      (item) => item.updatedAt > (known.get(item.id) ?? -Infinity),
    );
    const presentIds = new Set(items.map((item) => item.id));
    const deletedIds = Array.from(known.keys()).filter(
      (id) => !presentIds.has(id),
    );
    return {
      upserts,
      deletedIds,
      ids: new Set([...upserts.map((item) => item.id), ...deletedIds]),
    };
  },
  hashLines: () => Array.from(known, ([id, ts]) => ({ id, ts })),
  has: (id) => known.has(id),
  markSynced: (item) => {
    known.set(item.id, item.updatedAt);
  },
  noteRemoteTimestamp: (item) => {
    known.set(item.id, Math.max(item.updatedAt, known.get(item.id) ?? 0));
  },
  dropIds: (ids) => {
    ids.forEach((id) => known.delete(id));
  },
  snapshot: () => Object.fromEntries(known),
});

type RecordSyncTarget = {
  items: JournalItem[];
  loaded: boolean;
  writable: boolean;
  key: CryptoKey | null;
  savePath: string;
  streamType: "journal" | "space-updated";
  space?: string;
  cacheRestored?: boolean;
  storageFullKey?: string;
  timestampStore?: {
    savedTimestamps: Record<string, number> | undefined;
    save: (known: Record<string, number>) => void;
  };
  decorate: (item: JournalItem) => JournalItem;
  admit: (incoming: JournalItem[]) => JournalItem[];
  apply: (upserts: JournalItem[], deletedIds: string[]) => void;
};

export const applyRemoteTo =
  (dispatch: Dispatch<JournalAction>) =>
  (upserts: JournalItem[], deletedIds: string[]) =>
    flushSync(() => dispatch({ type: "applyRemote", upserts, deletedIds }));

export const useJournalSync = ({
  items,
  loaded,
  dispatch,
}: {
  items: JournalItem[];
  loaded: boolean;
  dispatch: Dispatch<JournalAction>;
}) => {
  const { masterKey } = useUser();
  return useRecordSync({
    items,
    loaded,
    writable: true,
    key: masterKey,
    savePath: "journal/save",
    streamType: "journal",
    decorate: identity,
    admit: identity,
    apply: applyRemoteTo(dispatch),
  });
};

export const useRecordSync = (target: RecordSyncTarget) => {
  const { items, loaded, key } = target;
  const { user } = useUser();
  const { post, serverMeta } = useApi();
  const active =
    loaded &&
    !!key &&
    (target.cacheRestored ?? true) &&
    (!target.timestampStore ||
      target.timestampStore.savedTimestamps !== undefined) &&
    user?.type === "online" &&
    !isSubscriptionMissing(user, serverMeta);
  const [queue] = useState(createSerialQueue);
  const [coalesce] = useState(() => createCoalescer(queue));
  const [syncState] = useState(() =>
    target.timestampStore
      ? timestampSyncState(new Map())
      : itemSyncState(new Map()),
  );
  const persistSyncState = useEffectEvent(() => {
    const snapshot = syncState.snapshot?.();
    if (snapshot) target.timestampStore?.save(snapshot);
  });
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);

  const latestItems = useEffectEvent(() => items);
  const decorate = useEffectEvent((item: JournalItem) => target.decorate(item));
  const admit = useEffectEvent((incoming: JournalItem[]) =>
    target.admit(incoming),
  );
  const applyRemote = useEffectEvent((upserts: JournalItem[], ids: string[]) =>
    target.apply(upserts, ids),
  );

  const send = useEffectEvent(
    async (
      upserts: JournalItem[],
      deletedIds: string[],
      key: CryptoKey,
      quiet: boolean,
    ) => {
      const gen = generation.current;
      const sendable: { item: JournalItem; record: EncryptedRecord }[] = [];
      for (const item of upserts) {
        const record = await encryptItem(item, key);
        if (base64ByteLength(record.data) <= MAX_ENCRYPTED_JOURNAL_BYTES) {
          sendable.push({ item, record });
        } else if (!quiet) {
          toast.error(t("journal.tooLarge", { name: item.name }), {
            id: `journal-too-large-${item.id}`,
          });
        }
      }

      const byId = new Map(
        sendable.map(({ item, record }) => [record.id, item]),
      );
      const changes: RecordChange[] = [
        ...deletedIds.map((id): RecordChange => ({ type: "deleted", id })),
        ...sendable.map(({ item, record }): RecordChange => ({
          type: syncState.has(item.id) ? "updated" : "added",
          record,
        })),
      ];

      for (let from = 0; from < changes.length; from += CHUNK_ITEMS) {
        const chunk = changes.slice(from, from + CHUNK_ITEMS);
        const res = await post(withClient(target.savePath), chunk);
        if (gen !== generation.current) return false;
        if (!res.success) {
          if (res.code === "storage_limit_reached" && !quiet)
            toast.error(t(target.storageFullKey ?? "journal.storageFull"), {
              id: target.space
                ? `journal-storage-full-${target.space}`
                : "journal-storage-full",
            });
          return false;
        }
        for (const change of chunk) {
          if (change.type === "deleted") syncState.dropIds([change.id]);
          else syncState.markSynced(byId.get(change.record.id)!);
        }
      }
      if (changes.length === 0) return false;

      persistSyncState();
      return true;
    },
  );

  const pushNow = useEffectEvent(async () => {
    if (!key || !active || !target.writable) return false;
    const { upserts, deletedIds } = syncState.pending(latestItems());
    setSaving(true);
    try {
      return await send(upserts, deletedIds, key, false);
    } finally {
      setSaving(false);
    }
  });

  const applyMerged = useEffectEvent(
    (received: JournalItem[], deleted: string[]) => {
      const incoming = admit(received);
      const current = latestItems();
      const pending = syncState.pending(current).ids;
      const { upserts, deletedIds } = mergeRemote(
        current,
        { incoming, deleted },
        pending,
      );
      syncState.dropIds(deleted);
      for (const item of incoming)
        if (!pending.has(item.id)) syncState.noteRemoteTimestamp?.(item);
      for (const item of upserts) syncState.markSynced(item);
      if (incoming.length > 0 || deleted.length > 0) persistSyncState();
      if (upserts.length === 0 && deletedIds.length === 0) return;

      applyRemote(upserts, deletedIds);
    },
  );

  const syncNow = useEffectEvent(async () => {
    if (!key) return;
    const gen = generation.current;
    const hashLines = syncState.hashLines(latestItems());

    const hashed = await syncPart<JournalHashResponse>(
      post,
      "journal/sync",
      target.space,
      { hash: await computeBucketHash(hashLines) },
    );
    if (!hashed.success || !hashed.data || hashed.data.match) return;

    const buckets = diffBuckets(
      await journalLinesTable(hashLines),
      hashed.data.table ?? "",
    );
    const cached = new Map(hashLines.map(({ id, ts }) => [id, ts]));

    for (let from = 0; from < buckets.length; from += SYNC_BUCKETS) {
      const requested = buckets.slice(from, from + SYNC_BUCKETS);
      let batch = requested;
      while (batch.length > 0) {
        const res = await syncPart<JournalSyncResponse>(
          post,
          "journal/sync",
          target.space,
          {
            buckets: batch,
            records: Array.from(cached)
              .filter(([id]) => batch.includes(journalBucket(id)))
              .map(([id, ts]) => ({ id, ts })),
          },
        );
        if (!res.success || !res.data) return;

        const { added, updated, deleted, remaining } = res.data;
        const incoming = (
          await Promise.all(
            [...added, ...updated].map((record) => decryptItem(record, key)),
          )
        )
          .filter(isPresent)
          .map(decorate);
        if (gen !== generation.current) return;

        applyMerged(incoming, deleted);
        for (const item of incoming) cached.set(item.id, item.updatedAt);
        for (const id of deleted) cached.delete(id);

        // a mismatch with nothing to pull means the server copy is stale, so re-save ours
        if (
          !target.timestampStore &&
          incoming.length + deleted.length === 0 &&
          remaining.length === 0
        ) {
          const newer = latestItems().filter((item) =>
            requested.includes(journalBucket(item.id)),
          );
          if (newer.length > 0 && target.writable)
            await send(newer, [], key, true);
        }
        batch = remaining;
      }
    }
  });

  const applyStream = useEffectEvent(async (message: StreamMessage) => {
    if (!key) return;
    if (!message.changes) return syncNow();

    const gen = generation.current;
    const changes = message.changes;
    const upserts = changes.filter((change) => change.type !== "deleted");
    const incoming = (
      await Promise.all(upserts.map((change) => decryptItem(change, key)))
    )
      .filter(isPresent)
      .map(decorate);
    if (gen !== generation.current) return;

    applyMerged(
      incoming,
      changes.flatMap((change) =>
        change.type === "deleted" ? [change.id] : [],
      ),
    );
    if (incoming.length < upserts.length) await syncNow();
  });

  const schedulePush = useEffectEvent(() =>
    queue(async () => {
      if (await pushNow()) await syncNow();
    }),
  );
  const scheduleSync = useEffectEvent(() =>
    coalesce(async () => {
      await syncNow();
      if (target.timestampStore && (await pushNow())) await syncNow();
    }),
  );
  const scheduleStream = useEffectEvent((message: StreamMessage) => {
    // space messages carry the space id, the own journal ignores them
    const forThis = !target.space || message.space === target.space;
    if (forThis && !isOwnMessage(message)) queue(() => applyStream(message));
  });

  const savedTimestamps = target.timestampStore?.savedTimestamps;
  useEffect(() => {
    generation.current++;
    syncState.reset(loaded ? latestItems() : [], savedTimestamps);
  }, [loaded, key, syncState, savedTimestamps, target.cacheRestored]);

  useEffect(() => {
    if (active) scheduleSync();
  }, [active, key, savedTimestamps]);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => schedulePush(), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [items, active]);

  useEffect(() => {
    if (!active) return;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") schedulePush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const stopJournal = onStream(target.streamType, (message) =>
      scheduleStream(message),
    );
    const stopSync = onStream("sync", (message) => {
      if (!isOwnMessage(message)) scheduleSync();
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopJournal();
      stopSync();
    };
  }, [active, target.streamType]);

  useEffect(() => () => void schedulePush(), []);

  return saving;
};
