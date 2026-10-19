import { computeBucketHash } from "@/lib/bucketHash";
import type { JournalItem } from "@/types/Journal";

export const CHUNK_ITEMS = 20;

const JOURNAL_BUCKET_CHARS = 2;
const JOURNAL_HASH_CHARS = 11;

export const journalBucket = (id: string) =>
  id.slice(0, JOURNAL_BUCKET_CHARS).toLowerCase();

const BUCKETS = Array.from({ length: 16 ** JOURNAL_BUCKET_CHARS }, (_, i) =>
  i.toString(16).padStart(JOURNAL_BUCKET_CHARS, "0"),
);

export const journalLines = (items: JournalItem[]) =>
  items.map((item) => ({ id: item.id, ts: item.updatedAt }));

export const journalLinesTable = async (
  lines: { id: string; ts: number }[],
) => {
  const byBucket = Map.groupBy(lines, (line) => journalBucket(line.id));
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

const differsOnlyInSharing = (
  item: JournalItem,
  acked: JournalItem | undefined,
) => acked?.updatedAt === item.updatedAt && acked._shared !== item._shared;

const isAcked = (item: JournalItem, acked: JournalItem | undefined) =>
  acked === item || differsOnlyInSharing(item, acked);

export const pendingChanges = (
  items: JournalItem[],
  acked: ReadonlyMap<string, JournalItem>,
) => {
  const ids = new Set(items.map((item) => item.id));
  const upserts = items.filter((item) => !isAcked(item, acked.get(item.id)));
  const deletedIds = Array.from(acked.keys()).filter((id) => !ids.has(id));
  return {
    upserts,
    deletedIds,
    ids: new Set([...upserts.map((item) => item.id), ...deletedIds]),
  };
};
