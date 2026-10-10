import { computeBucketHash } from "@/lib/bucketHash";
import type { JournalItem } from "@/types/Journal";

const JOURNAL_BUCKET_CHARS = 2;
const JOURNAL_HASH_CHARS = 11;

export const journalBucket = (id: string) =>
  id.slice(0, JOURNAL_BUCKET_CHARS).toLowerCase();

const BUCKETS = Array.from({ length: 16 ** JOURNAL_BUCKET_CHARS }, (_, i) =>
  i.toString(16).padStart(JOURNAL_BUCKET_CHARS, "0"),
);

export const journalLines = (items: JournalItem[]) =>
  items.map((item) => ({ id: item.id, ts: item.updatedAt }));

export const journalHashTable = async (items: JournalItem[]) => {
  const byBucket = Map.groupBy(journalLines(items), (line) =>
    journalBucket(line.id),
  );
  const hashes = await Promise.all(
    BUCKETS.map(async (bucket) =>
      (await computeBucketHash(byBucket.get(bucket) ?? [])).slice(
        0,
        JOURNAL_HASH_CHARS,
      ),
    ),
  );
  return hashes.join("");
};

export const diffBuckets = (localTable: string, serverTable: string) =>
  BUCKETS.filter((_, i) => {
    const from = i * JOURNAL_HASH_CHARS;
    const to = from + JOURNAL_HASH_CHARS;
    return localTable.slice(from, to) !== serverTable.slice(from, to);
  });

export const mergeRemote = (
  items: JournalItem[],
  remote: { incoming: JournalItem[]; deleted: string[] },
  pending: ReadonlySet<string>,
) => {
  const local = new Map(items.map((item) => [item.id, item]));
  return {
    upserts: remote.incoming.filter(
      (item) =>
        !pending.has(item.id) &&
        item.updatedAt > (local.get(item.id)?.updatedAt ?? -Infinity),
    ),
    deletedIds: remote.deleted.filter(
      (id) => !pending.has(id) && local.has(id),
    ),
  };
};

export const pendingChanges = (
  items: JournalItem[],
  acked: ReadonlyMap<string, JournalItem>,
) => {
  const ids = new Set(items.map((item) => item.id));
  const upserts = items.filter((item) => acked.get(item.id) !== item);
  const removed = Array.from(acked.keys()).filter((id) => !ids.has(id));
  return {
    upserts,
    removed,
    ids: new Set([...upserts.map((item) => item.id), ...removed]),
  };
};
