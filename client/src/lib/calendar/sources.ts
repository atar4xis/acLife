import { t } from "@/i18n";
import { decryptEvents, decryptSpaceEvents } from "@/lib/calendar/crypt";
import { computeEventBuckets } from "@/lib/calendar/buckets";
import type { EventCache } from "@/lib/calendar/eventCache";
import { mayWrite } from "@/lib/shareInfo";
import type { StreamChange } from "@/lib/stream";
import { identity } from "@/lib/utils";
import type {
  CalendarEvent,
  DecryptedEvent,
  EncryptedEvent,
  EventChange,
  RejectedEvent,
} from "@/types/calendar/Event";
import type { JoinedSpace, OwnedSpace, SharedInfo } from "@/types/Share";
import { changeId } from "@/lib/calendar/shared";

export const rejectOversized = (
  changes: EventChange[],
  oversized: Set<string>,
  cached: CalendarEvent[],
): RejectedEvent[] => {
  const previous = new Map(cached.map((ev) => [ev.id, ev]));
  const rejected: RejectedEvent[] = [];

  for (const id of oversized) {
    const mine = changes.filter((c) => changeId(c) === id);
    if (mine.at(-1)!.type === "deleted") continue;
    rejected.push({
      id,
      title: mine.findLast((c) => c.event)!.event!.title,
      wasAdded: mine.some((c) => c.type === "added"),
      previous: previous.get(id),
    });
  }

  return rejected;
};

type UpsertEntry = { id: string; updatedAt: number; event: CalendarEvent };

const attachBuckets = (
  encrypted: { id: string; data: string }[],
  entries: UpsertEntry[],
  bucketKey: CryptoKey,
) => {
  const raw = new Map(encrypted.map((e) => [e.id, e.data]));
  return Promise.all(
    entries.map(async ({ id, updatedAt, event }) => ({
      id,
      data: raw.get(id)!,
      updatedAt,
      buckets: await computeEventBuckets(event, bucketKey),
      event,
    })),
  );
};

export const upsertsFromDecrypted = (
  encrypted: { id: string; data: string }[],
  decrypted: DecryptedEvent[],
  bucketKey: CryptoKey,
) =>
  attachBuckets(
    encrypted,
    decrypted.map((ev) => ({
      id: ev.id,
      updatedAt: ev.updatedAt,
      event: { ...ev.data, timestamp: ev.updatedAt },
    })),
    bucketKey,
  );

export const upsertsFromSaved = (
  events: CalendarEvent[],
  encrypted: { id: string; data: string }[],
  bucketKey: CryptoKey,
) =>
  attachBuckets(
    encrypted,
    events.map((event) => ({
      id: event.id,
      updatedAt: event.timestamp,
      event,
    })),
    bucketKey,
  );

export const freshStreamChanges = async (
  { cache, key, bucketKey, decrypt }: CalendarSource,
  changes: StreamChange[],
) => {
  const deleted = changes.flatMap((c) => (c.type === "deleted" ? [c.id] : []));
  const deletedIds = new Set(deleted);
  const upserted = changes.filter((c) => c.type !== "deleted");
  const incoming = await decrypt(upserted, key);
  // skip stream change older than the cached copy
  const known = new Map(
    (await cache.records(incoming.map((ev) => ev.id)))
      .filter((r) => !deletedIds.has(r.id))
      .map((r) => [r.id, r.updatedAt]),
  );
  const fresh = incoming.filter(
    (ev) => (known.get(ev.id) ?? -Infinity) < ev.updatedAt,
  );

  return {
    deleted,
    upserts: await upsertsFromDecrypted(upserted, fresh, bucketKey),
  };
};

export type CalendarSource = {
  cache: EventCache;
  key: CryptoKey;
  bucketKey: CryptoKey;
  space?: string;
  savePath: string;
  writable: boolean;
  storageFullKey?: string;
  decrypt: typeof decryptEvents;
  decorate: (event: CalendarEvent) => CalendarEvent;
};

export type AdoptedChanges = { events: CalendarEvent[]; deletedIds: string[] };

export type SharedPull = {
  adopted: CalendarEvent[];
  joined: CalendarEvent[];
  deletedIds: string[];
};

export type MirroredSpace = { space: OwnedSpace; source: CalendarSource };

export type SourceSyncer = (
  source: CalendarSource,
  buckets: string[],
  onDeleted?: (ids: string[]) => void,
) => Promise<CalendarEvent[]>;

export type SourceSaver = (
  source: CalendarSource,
  changes: EventChange[],
  onRejected?: (rejected: RejectedEvent[]) => void,
) => Promise<{
  changes: EventChange[];
  encrypted: EncryptedEvent[];
  dropped?: boolean;
} | null>;

export const BACKFILL_BUCKET_CHUNK = 100;
export const BACKFILL_SAVE_CHUNK = 200;

export const noAdoptedChanges: AdoptedChanges = { events: [], deletedIds: [] };

// spaces are keyed by the space key, so their events don't use the master key
export const spaceSource = (
  cache: EventCache,
  space: JoinedSpace | OwnedSpace,
  info?: SharedInfo,
): CalendarSource => ({
  cache,
  key: space.keys.key,
  bucketKey: space.keys.bucketKey,
  space: space.id,
  savePath: `shares/save?space=${space.id}`,
  writable: mayWrite(info),
  storageFullKey: info ? "shares.memberStorageFull" : "shares.ownerStorageFull",
  decrypt: decryptSpaceEvents,
  decorate: info ? (event) => ({ ...event, _shared: info }) : identity,
});

export const personalSource = (
  cache: EventCache,
  key: CryptoKey,
  bucketKey: CryptoKey,
): CalendarSource => ({
  cache,
  key,
  bucketKey,
  savePath: "calendar/events/save",
  writable: true,
  decrypt: decryptEvents,
  decorate: identity,
});

export const updatedAtById = async (cache: EventCache, ids: string[]) =>
  new Map((await cache.records(ids)).map((r) => [r.id, r.updatedAt]));

export const eventsNewerThan = (
  known: ReadonlyMap<string, number>,
  events: CalendarEvent[],
) => events.filter((ev) => ev.timestamp > (known.get(ev.id) ?? -Infinity));

export const syncError = (res: { message?: string }) =>
  new Error(
    t(res.message ? "events.syncFailedWith" : "events.syncFailed", {
      message: res.message,
    }),
  );

export const cachedWindow = async (
  { cache, key }: CalendarSource,
  buckets: string[],
) => {
  const index = await cache.readIndex(buckets, key);
  return cache.events(
    buckets.flatMap((b) => index.get(b)!.map((e) => e.id)),
    key,
  );
};
