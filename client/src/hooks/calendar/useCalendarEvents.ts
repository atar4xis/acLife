import { decryptJson, encryptJson } from "@/lib/crypt";
import { useApi } from "@/context/ApiContext";
import { useStorage } from "@/context/StorageContext";
import { deleteDescriptionSizes } from "@/lib/calendar/descriptionSize";
import {
  cookEvent,
  encryptEvents,
  MAX_ENCRYPTED_EVENT_BYTES,
} from "@/lib/calendar/crypt";
import { computeBucketHash } from "@/lib/bucketHash";
import { createEventCache, type EventCache } from "@/lib/calendar/eventCache";
import {
  computeExpandedRangeBuckets,
  computeSyncRangeBuckets,
} from "@/lib/calendar/buckets";
import { useCalendarMirror } from "@/hooks/calendar/useCalendarMirror";
import { useShares } from "@/context/ShareContext";
import { changeId, mergeSources, spaceOf } from "@/lib/calendar/shared";
import {
  BACKFILL_SAVE_CHUNK,
  cachedWindow,
  freshStreamChanges,
  noAdoptedChanges,
  personalSource,
  rejectOversized,
  spaceSource,
  syncError,
  upsertsFromDecrypted,
  type CalendarSource,
  type SharedPull,
  type AdoptedChanges,
} from "@/lib/calendar/sources";
import { sharedCacheName } from "@/lib/sharedCache";
import { toSharedInfo } from "@/lib/shareInfo";
import { base64ByteLength } from "@/lib/utils";
import type {
  CalendarEvent,
  EventHashRequest,
  EventHashResponse,
  EventSyncRequest,
  EventSyncResponse,
  EventChange,
  RawCalendarEvent,
  RejectedEvent,
} from "@/types/calendar/Event";
import type { User } from "@/types/User";
import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { withClient } from "@/lib/clientId";
import { createCoalescer, createSerialQueue } from "@/lib/serialQueue";
import { syncPart } from "@/lib/syncBatch";
import type { StreamChange } from "@/lib/stream";
import { t } from "@/i18n";

export const useCalendarEvents = (
  user: User | null,
  masterKey: CryptoKey | null,
  bucketKey: CryptoKey | null,
) => {
  const [saving, setSaving] = useState(false);
  const { get: getStored, set: setStored, ready } = useStorage();
  const { post } = useApi();
  const { joined, owned } = useShares();

  const [cache] = useState(createEventCache);
  const [cacheQueue] = useState(createSerialQueue);
  const [coalesce] = useState(() => createCoalescer(cacheQueue));
  const [saveQueue] = useState(createSerialQueue);
  const [spaceCaches] = useState(() => new Map<string, EventCache>());
  const masterKeyRef = useRef(masterKey);
  useEffect(() => {
    masterKeyRef.current = masterKey;
  }, [masterKey]);

  useEffect(() => {
    if (ready && getStored("cachedEvents")) setStored("cachedEvents", null);
  }, [ready, getStored, setStored]);

  const cacheOf = useCallback(
    (space: string) => {
      let spaceCache = spaceCaches.get(space);
      if (!spaceCache) {
        spaceCache = createEventCache(sharedCacheName(space));
        spaceCaches.set(space, spaceCache);
      }
      return spaceCache;
    },
    [spaceCaches],
  );

  const joinedList = useMemo(
    () =>
      joined
        .filter((space) => space.kind === "calendar")
        // writable spaces first, mergeSources keeps the first copy of an id
        .toSorted(
          (a, b) =>
            Number(b.permission === "write") - Number(a.permission === "write"),
        )
        .map((space) => ({
          space,
          source: spaceSource(cacheOf(space.id), space, toSharedInfo(space)),
        })),
    [joined, cacheOf],
  );
  const joinedSources = useMemo(
    () => joinedList.map(({ source }) => source),
    [joinedList],
  );
  const joinedById = useMemo(
    () => new Map(joinedList.map(({ space, source }) => [space.id, source])),
    [joinedList],
  );

  const mirrors = useMemo(
    () =>
      owned
        .filter((space) => space.kind === "calendar")
        .map((space) => ({
          space,
          source: spaceSource(cacheOf(space.id), space),
        })),
    [owned, cacheOf],
  );

  const ownSource = useMemo(
    () =>
      masterKey && bucketKey
        ? personalSource(cache, masterKey, bucketKey)
        : null,
    [cache, masterKey, bucketKey],
  );

  const readCache = useCallback(
    async <T>(
      eventCache: EventCache,
      read: () => Promise<T>,
      fallback: T,
    ): Promise<T> => {
      try {
        return await read();
      } catch {
        toast.warning(t("events.cacheDecryptFailed"));
        await eventCache.clear().catch(() => {});
        return fallback;
      }
    },
    [],
  );

  const saveTo = useCallback(
    async (
      source: CalendarSource,
      changes: EventChange[],
      onRejected?: (rejected: RejectedEvent[]) => void,
    ) => {
      const { cache: sourceCache, key, bucketKey } = source;
      const toEncrypt = changes
        .filter((c) => c.type !== "deleted")
        .map((c) => c.event!);
      const encryptedEvents = await encryptEvents(toEncrypt, key, bucketKey);

      const oversized = new Set(
        encryptedEvents
          .filter((e) => base64ByteLength(e.data) > MAX_ENCRYPTED_EVENT_BYTES)
          .map((e) => e.id),
      );

      if (oversized.size > 0) {
        const cached = await sourceCache
          .events([...oversized], key)
          .catch(() => []);
        const rejected = rejectOversized(changes, oversized, cached);

        changes = changes.filter(
          (c) => c.type === "deleted" || !oversized.has(c.event!.id),
        );

        if (rejected.length > 0) {
          toast.error(
            t(
              rejected.length === 1 ? "events.tooLarge" : "events.tooLargeMany",
              { count: rejected.length, title: rejected[0].title },
            ),
          );
        }
        onRejected?.(rejected);

        if (changes.length === 0) return { changes, encrypted: [] };
      }

      // build a map of (eventId: encryptedEvent) for quick lookup
      const encryptedMap = new Map(encryptedEvents.map((e) => [e.id, e]));
      const payload = changes.map((c) => {
        if (c.type === "deleted") return { type: "deleted", id: c.id };
        return { type: c.type, record: encryptedMap.get(c.event!.id)! };
      });

      const res = await post(withClient(source.savePath), payload);
      if (!res.success) {
        toast.error(
          res.code === "storage_limit_reached" && source.storageFullKey
            ? t(source.storageFullKey)
            : t(res.message ? "events.saveFailedWith" : "events.saveFailed", {
                message: res.message,
              }),
        );
        // retrying cannot succeed, so the changes are dropped
        const dropped =
          res.code === "share_not_found" ||
          res.code === "share_forbidden" ||
          (res.code === "storage_limit_reached" && !!source.space);
        if (dropped) return { changes: [], encrypted: [], dropped };
        return null;
      }
      return { changes, encrypted: encryptedEvents };
    },
    [post],
  );

  const resave = useCallback(
    async (source: CalendarSource, events: CalendarEvent[]) => {
      for (let from = 0; from < events.length; from += BACKFILL_SAVE_CHUNK) {
        const chunk = events.slice(from, from + BACKFILL_SAVE_CHUNK);
        const saved = await saveTo(
          source,
          chunk.map((event) => ({ type: "updated", event })),
        );
        if (!saved) return;
      }
    },
    [saveTo],
  );

  const syncSourceNow = useCallback(
    async (
      source: CalendarSource,
      buckets: string[],
      onDeleted?: (ids: string[]) => void,
    ): Promise<CalendarEvent[]> => {
      const { cache: sourceCache, key, bucketKey } = source;
      const index = await readCache(
        sourceCache,
        () => sourceCache.readIndex(buckets, key),
        new Map(buckets.map((b) => [b, []])),
      );
      const idsIn = (bucketIds: string[]) => [
        ...new Set(bucketIds.flatMap((b) => index.get(b)!.map((e) => e.id))),
      ];

      let mismatched = buckets;
      if (idsIn(buckets).length > 0) {
        const hashRes = await syncPart<EventHashResponse>(
          post,
          "calendar/events/sync",
          source.space,
          {
            hashes: Object.fromEntries(
              await Promise.all(
                buckets.map(async (b) => [
                  b,
                  await computeBucketHash(index.get(b)!),
                ]),
              ),
            ),
          } satisfies EventHashRequest,
        );

        if (!hashRes.success || !hashRes.data) {
          throw syncError(hashRes);
        }

        mismatched = hashRes.data.mismatched;
        if (mismatched.length === 0) {
          return readCache(
            sourceCache,
            () => sourceCache.events(idsIn(buckets), key),
            [],
          );
        }
      }

      const known = new Map(
        mismatched.flatMap((b) => index.get(b)!.map((e) => [e.id, e.ts])),
      );

      const request: EventSyncRequest = {
        records: Array.from(known, ([id, ts]) => ({ id, ts })),
        buckets: mismatched,
      };

      // request sync from server, providing a map of our cached events
      const res = await syncPart<EventSyncResponse>(
        post,
        "calendar/events/sync",
        source.space,
        request,
      );

      if (!res.success || !res.data) {
        throw syncError(res);
      }

      // the server tells us which events were updated, added, and deleted
      const { updated, added, deleted } = res.data;
      deleteDescriptionSizes(deleted);

      try {
        const incoming = [...updated, ...added];
        const upserts = await upsertsFromDecrypted(
          incoming,
          await source.decrypt(incoming, key),
          bucketKey,
        );

        await readCache(
          sourceCache,
          () => sourceCache.apply(upserts, deleted, key),
          undefined,
        );
        if (deleted.length > 0) onDeleted?.(deleted);

        // a mismatch with nothing to pull means the server copy is stale, so re-save ours
        const nothingToApply =
          !updated.length && !added.length && !deleted.length;
        if (nothingToApply && known.size > 0 && source.writable) {
          sourceCache
            .events([...known.keys()], key)
            .then((events) => resave(source, events))
            .catch(() => {});
        }

        return await cachedWindow(source, buckets);
      } catch {
        toast.error(t("events.decryptFailed"));
        return [];
      }
    },
    [post, readCache, resave],
  );

  const syncBuckets = useCallback(
    (buckets: string[], masterKey: CryptoKey, bucketKey: CryptoKey) =>
      cacheQueue(() =>
        syncSourceNow(personalSource(cache, masterKey, bucketKey), buckets),
      ),
    [cacheQueue, syncSourceNow, cache],
  );

  const { adoptIntoOwn, pullStale, mirrorOut } = useCalendarMirror({
    cache,
    cacheQueue,
    mirrors,
    user,
    masterKey,
    bucketKey,
    syncSourceNow,
    saveTo,
  });

  const pullJoined = useCallback(
    async (source: CalendarSource, buckets: string[]) => {
      try {
        return (await syncSourceNow(source, buckets)).map(source.decorate);
      } catch {
        return (await cachedWindow(source, buckets).catch(() => [])).map(
          source.decorate,
        );
      }
    },
    [syncSourceNow],
  );

  const syncShared = useCallback(
    async (
      masterKey: CryptoKey,
      bucketKey: CryptoKey,
      weeks: (key: CryptoKey) => Promise<string[]>,
    ): Promise<SharedPull> => {
      const [joined, adopted] = await Promise.all([
        Promise.all(
          joinedSources.map(async (source) =>
            pullJoined(source, await weeks(source.bucketKey)),
          ),
        ),
        pullStale(masterKey, bucketKey, weeks),
      ]);

      return {
        joined: joined.flat(),
        adopted: adopted.events,
        deletedIds: adopted.deletedIds,
      };
    },
    [joinedSources, pullJoined, pullStale],
  );

  const syncExpanded = useCallback(
    (
      currentDate: DateTime,
      masterKey: CryptoKey,
      bucketKey: CryptoKey,
      fromRange: number,
      toRange: number,
    ) => {
      const weeks = (key: CryptoKey) =>
        computeExpandedRangeBuckets(currentDate, key, fromRange, toRange);

      return cacheQueue(async () => {
        const [own, shared] = await Promise.all([
          syncSourceNow(
            personalSource(cache, masterKey, bucketKey),
            await weeks(bucketKey),
          ),
          syncShared(masterKey, bucketKey, weeks),
        ]);
        return mergeSources(own, [...shared.adopted, ...shared.joined]);
      });
    },
    [cacheQueue, cache, syncSourceNow, syncShared],
  );

  const applyChanges = useCallback(
    (changes: StreamChange[], masterKey: CryptoKey, bucketKey: CryptoKey) =>
      cacheQueue(async () => {
        const { deleted, upserts } = await freshStreamChanges(
          personalSource(cache, masterKey, bucketKey),
          changes,
        );

        // the user may have locked or switched accounts while this was running
        if (masterKeyRef.current === masterKey) {
          await cache.apply(upserts, deleted, masterKey);
        }
        return upserts.map((u) => u.event);
      }),
    [cacheQueue, cache],
  );

  const applySharedChanges = useCallback(
    (
      space: string,
      changes: StreamChange[],
      fromThisClient: boolean,
      masterKey: CryptoKey,
      bucketKey: CryptoKey,
    ): Promise<AdoptedChanges> =>
      cacheQueue(async () => {
        const joinedSource = joinedById.get(space);
        const mirror = mirrors.find((m) => m.space.id === space);
        const source = joinedSource ?? mirror?.source;
        if (!source) return noAdoptedChanges;

        const { deleted, upserts } = await freshStreamChanges(source, changes);
        if (masterKeyRef.current !== masterKey) return noAdoptedChanges;
        await source.cache.apply(upserts, deleted, source.key);

        if (joinedSource) {
          const own = await cache.records([
            ...upserts.map((u) => u.id),
            ...deleted,
          ]);
          // an event the user also has in their own calendar shows the own copy
          const ownCachedIds = new Set(own.map((r) => r.id));
          return {
            events: upserts
              .filter((u) => !ownCachedIds.has(u.id))
              .map((u) => source.decorate(u.event)),
            deletedIds: deleted.filter((id) => !ownCachedIds.has(id)),
          };
        }
        if (fromThisClient || !mirror) return noAdoptedChanges;

        return adoptIntoOwn(
          mirror.space,
          upserts.map((u) => u.event),
          deleted,
          masterKey,
          bucketKey,
        );
      }),
    [cacheQueue, cache, joinedById, mirrors, adoptIntoOwn],
  );

  const syncEvents = useCallback(
    (
      user: User,
      masterKey: CryptoKey,
      bucketKey: CryptoKey,
      currentDate: DateTime,
    ): Promise<CalendarEvent[]> => {
      if (user.type !== "online")
        throw new Error("Cannot syncEvents for offline user.");

      return coalesce(async () => {
        const requestedBuckets = await computeSyncRangeBuckets(
          currentDate,
          bucketKey,
        );
        const ownEventsPromise = syncSourceNow(
          personalSource(cache, masterKey, bucketKey),
          requestedBuckets,
        );
        if (joinedSources.length + mirrors.length === 0)
          return ownEventsPromise;

        const [own, shared] = await Promise.all([
          ownEventsPromise,
          syncShared(masterKey, bucketKey, (key) =>
            computeSyncRangeBuckets(currentDate, key),
          ),
        ]);
        const adoptedById = new Map(shared.adopted.map((ev) => [ev.id, ev]));
        const deletedIds = new Set(shared.deletedIds);
        // a newer edit adopted from a space replaces the own copy
        const reconciled = own
          .filter((ev) => !deletedIds.has(ev.id))
          .map((ev) => {
            const next = adoptedById.get(ev.id);
            return next && next.timestamp > ev.timestamp ? next : ev;
          });

        return mergeSources(
          mergeSources(reconciled, shared.adopted),
          shared.joined,
        );
      });
    },
    [coalesce, cache, syncSourceNow, syncShared, joinedSources, mirrors],
  );

  const loadEvents = useCallback(
    async (
      user: User,
      masterKey: CryptoKey,
      bucketKey: CryptoKey | null,
      currentDate: DateTime,
    ): Promise<CalendarEvent[]> => {
      // for online users, we sync events with the server
      if (user.type === "online") {
        try {
          if (!bucketKey) throw new Error("Missing bucket key.");
          return await syncEvents(user, masterKey, bucketKey, currentDate);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : (err as string);
          toast.error(errMsg);
          const own = await readCache(
            cache,
            () => cache.allEvents(masterKey),
            [],
          );
          const shared = await Promise.all(
            joinedSources.map(async (source) =>
              (
                await readCache(
                  source.cache,
                  () => source.cache.allEvents(source.key),
                  [],
                )
              ).map(source.decorate),
            ),
          );
          return mergeSources(own, shared.flat());
        }
      }

      // for offline users, we just decrypt from storage
      try {
        const events = getStored("offlineEvents");
        return events
          ? (await decryptJson<RawCalendarEvent[]>(events, masterKey)).map(
              cookEvent,
            )
          : [];
      } catch {
        toast.error(t("events.decryptFailed"));
        return [];
      }
    },
    [getStored, syncEvents, readCache, cache, joinedSources],
  );

  const saveEventsNow = useCallback(
    async (
      changes: EventChange[] | CalendarEvent[],
      cb: () => void,
      onRejected?: (rejected: RejectedEvent[]) => void,
    ) => {
      if (!changes || changes.length === 0) return;

      setSaving(true);

      try {
        if (!masterKey) return;

        if (user?.type === "online") {
          if (!bucketKey || !ownSource) return;

          const allChanges = changes as EventChange[];
          const upsertsById = Map.groupBy(
            allChanges.filter((c) => c.type !== "deleted"),
            changeId,
          );
          const isMovedOut = (space: string | undefined, c: EventChange) =>
            c.type === "deleted" &&
            !!upsertsById.get(changeId(c))?.some((u) => spaceOf(u) !== space);
          const changesBySpace = [...Map.groupBy(allChanges, spaceOf)].toSorted(
            ([spaceA, a], [spaceB, b]) =>
              Number(a.some((c) => isMovedOut(spaceA, c))) -
              Number(b.some((c) => isMovedOut(spaceB, c))),
          );
          const unsavedIds = new Set<string>();
          let allSaved = true;
          let ownSavedChanges: EventChange[] = [];

          for (const [space, group] of changesBySpace) {
            const source = space ? joinedById.get(space) : ownSource;
            if (!source?.writable) {
              toast.error(t("events.saveFailed"));
              for (const c of group)
                if (c.type !== "deleted") unsavedIds.add(changeId(c));
              continue;
            }

            const toSend = group.filter(
              (c) => c.type !== "deleted" || !unsavedIds.has(changeId(c)),
            );
            if (toSend.length === 0) continue;

            const saved = await saveTo(source, toSend, onRejected);
            const savedIds = new Set(saved?.changes.map(changeId));
            for (const c of toSend)
              if (c.type !== "deleted" && !savedIds.has(changeId(c)))
                unsavedIds.add(changeId(c));

            allSaved = !!saved && allSaved;
            if (saved && !space) ownSavedChanges = saved.changes;
          }

          if (allSaved) allSaved = await mirrorOut(ownSavedChanges);
          if (!allSaved) {
            setSaving(false);
            return;
          }

          setSaving(false);
          cb();
        } else {
          // for offline users just encrypt and store all events locally
          const allEvents = changes as CalendarEvent[];
          const encrypted = await encryptJson(allEvents, masterKey);

          setStored("offlineEvents", encrypted);

          setSaving(false);
          cb();
        }
      } catch {
        toast.error(t("events.saveFailed"));
        setSaving(false);
      }
    },
    [
      masterKey,
      bucketKey,
      ownSource,
      joinedById,
      saveTo,
      mirrorOut,
      setStored,
      user?.type,
    ],
  );

  const saveEvents = useCallback(
    (...args: Parameters<typeof saveEventsNow>) =>
      saveQueue(() => saveEventsNow(...args)),
    [saveQueue, saveEventsNow],
  );

  return {
    loadEvents,
    syncEvents,
    syncBuckets,
    syncExpanded,
    applyChanges,
    applySharedChanges,
    saveEvents,
    saving,
  };
};
