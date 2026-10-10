import { useApi } from "@/context/ApiContext";
import { useUser } from "@/context/UserContext";
import { t } from "@/i18n";
import { computeBucketHash } from "@/lib/bucketHash";
import { CLIENT_ID } from "@/lib/clientId";
import {
  decryptItem,
  encryptItem,
  MAX_ENCRYPTED_JOURNAL_BYTES,
} from "@/lib/journal/crypt";
import {
  diffBuckets,
  journalBucket,
  journalHashTable,
  journalLines,
  mergeRemote,
  pendingChanges,
} from "@/lib/journal/sync";
import { createSerialQueue } from "@/lib/serialQueue";
import { isOwnMessage, onStream, type StreamMessage } from "@/lib/stream";
import { isSubscriptionMissing } from "@/lib/subscription";
import { base64ByteLength } from "@/lib/utils";
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
const CHUNK_ITEMS = 20;
const SYNC_BUCKETS = 16;

const present = <T>(value: T | null): value is T => value !== null;

export const useJournalSync = ({
  items,
  loaded,
  dispatch,
}: {
  items: JournalItem[];
  loaded: boolean;
  dispatch: Dispatch<JournalAction>;
}) => {
  const { user, masterKey } = useUser();
  const { post, serverMeta } = useApi();
  const active =
    loaded &&
    !!masterKey &&
    user?.type === "online" &&
    !isSubscriptionMissing(user, serverMeta);
  const [queue] = useState(createSerialQueue);
  const [acked] = useState(() => new Map<string, JournalItem>());
  const generation = useRef(0);

  const latestItems = useEffectEvent(() => items);

  const send = useEffectEvent(
    async (
      upserts: JournalItem[],
      removed: string[],
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
        ...removed.map((id): RecordChange => ({ type: "deleted", id })),
        ...sendable.map(({ item, record }): RecordChange => ({
          type: acked.has(item.id) ? "updated" : "added",
          record,
        })),
      ];

      for (let from = 0; from < changes.length; from += CHUNK_ITEMS) {
        const chunk = changes.slice(from, from + CHUNK_ITEMS);
        const res = await post("journal/save?c=" + CLIENT_ID, chunk);
        if (gen !== generation.current) return false;
        if (!res.success) {
          if (res.code === "storage_limit_reached" && !quiet)
            toast.error(t("journal.storageFull"), {
              id: "journal-storage-full",
            });
          return false;
        }
        for (const change of chunk) {
          if (change.type === "deleted") acked.delete(change.id);
          else acked.set(change.record.id, byId.get(change.record.id)!);
        }
      }
      return changes.length > 0;
    },
  );

  const pushNow = useEffectEvent(async () => {
    if (!masterKey || !active) return false;
    const { upserts, removed } = pendingChanges(latestItems(), acked);
    return send(upserts, removed, masterKey, false);
  });

  const applyMerged = useEffectEvent(
    (incoming: JournalItem[], deleted: string[]) => {
      const current = latestItems();
      const { upserts, deletedIds } = mergeRemote(
        current,
        { incoming, deleted },
        pendingChanges(current, acked).ids,
      );
      if (upserts.length === 0 && deletedIds.length === 0) return;

      for (const item of upserts) acked.set(item.id, item);
      for (const id of deletedIds) acked.delete(id);
      flushSync(() => dispatch({ type: "applyRemote", upserts, deletedIds }));
    },
  );

  const syncNow = useEffectEvent(async () => {
    if (!masterKey) return;
    const gen = generation.current;
    const start = latestItems();

    const hashed = await post<JournalHashResponse>("journal/sync", {
      hash: await computeBucketHash(journalLines(start)),
    });
    if (!hashed.success || !hashed.data || hashed.data.match) return;

    const buckets = diffBuckets(
      await journalHashTable(start),
      hashed.data.table ?? "",
    );
    const known = new Map(start.map((item) => [item.id, item.updatedAt]));

    for (let from = 0; from < buckets.length; from += SYNC_BUCKETS) {
      const requested = buckets.slice(from, from + SYNC_BUCKETS);
      let batch = requested;
      while (batch.length > 0) {
        const res = await post<JournalSyncResponse>("journal/sync", {
          buckets: batch,
          records: Array.from(known)
            .filter(([id]) => batch.includes(journalBucket(id)))
            .map(([id, ts]) => ({ id, ts })),
        });
        if (!res.success || !res.data) return;

        const { added, updated, deleted, remaining } = res.data;
        const incoming = (
          await Promise.all(
            [...added, ...updated].map((record) =>
              decryptItem(record, masterKey),
            ),
          )
        ).filter(present);
        if (gen !== generation.current) return;

        applyMerged(incoming, deleted);
        for (const item of incoming) known.set(item.id, item.updatedAt);
        for (const id of deleted) known.delete(id);

        if (incoming.length + deleted.length === 0 && remaining.length === 0) {
          const newer = latestItems().filter((item) =>
            requested.includes(journalBucket(item.id)),
          );
          if (newer.length > 0) await send(newer, [], masterKey, true);
        }
        batch = remaining;
      }
    }
  });

  const applyStream = useEffectEvent(async (message: StreamMessage) => {
    if (!masterKey) return;
    if (!message.changes) return syncNow();

    const gen = generation.current;
    const changes = message.changes;
    const upserts = changes.filter((change) => change.type !== "deleted");
    const incoming = (
      await Promise.all(upserts.map((change) => decryptItem(change, masterKey)))
    ).filter(present);
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
  const scheduleSync = useEffectEvent(() => queue(() => syncNow()));
  const scheduleStream = useEffectEvent((message: StreamMessage) => {
    if (!isOwnMessage(message)) queue(() => applyStream(message));
  });

  useEffect(() => {
    generation.current++;
    acked.clear();
    if (loaded) for (const item of latestItems()) acked.set(item.id, item);
  }, [loaded, masterKey, acked]);

  useEffect(() => {
    if (active) scheduleSync();
  }, [active, masterKey]);

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
    const stopJournal = onStream("journal", (message) =>
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
  }, [active]);

  useEffect(() => () => void schedulePush(), []);
};
