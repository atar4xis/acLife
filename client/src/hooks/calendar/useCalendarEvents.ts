import { decryptJson, encryptJson } from "@/lib/crypt";
import { useApi } from "@/context/ApiContext";
import { useStorage } from "@/context/StorageContext";
import { deleteDescriptionSizes } from "@/lib/calendar/descriptionSize";
import {
  cookEvent,
  decryptEvents,
  encryptEvents,
  MAX_ENCRYPTED_EVENT_BYTES,
} from "@/lib/calendar/crypt";
import { computeBucketHash } from "@/lib/bucketHash";
import { createEventCache } from "@/lib/calendar/eventCache";
import {
  computeEventBuckets,
  computeSyncRangeBuckets,
} from "@/lib/calendar/buckets";
import { base64ByteLength, uuidToBase64 } from "@/lib/utils";
import type {
  CalendarEvent,
  DecryptedEvent,
  EventHashRequest,
  EventHashResponse,
  EventSyncRequest,
  EventSyncResponse,
  EventChange,
  RawCalendarEvent,
  RejectedEvent,
  WithoutPrivateKeys,
} from "@/types/calendar/Event";
import type { User } from "@/types/User";
import type { DateTime } from "luxon";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CLIENT_ID } from "@/lib/clientId";
import { createSerialQueue } from "@/lib/serialQueue";
import type { StreamChange } from "@/lib/stream";
import { t } from "@/i18n";

const withoutPrivateKeys = (event: CalendarEvent) =>
  Object.fromEntries(
    Object.entries(event).filter(([key]) => !key.startsWith("_")),
  ) as WithoutPrivateKeys<CalendarEvent>;

const rejectOversized = (
  changes: EventChange[],
  oversized: Set<string>,
  cached: CalendarEvent[],
): RejectedEvent[] => {
  const previous = new Map(cached.map((ev) => [ev.id, ev]));
  const rejected: RejectedEvent[] = [];

  for (const id of oversized) {
    const mine = changes.filter((c) => (c.event?.id ?? c.id) === id);
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

const toUpserts = (
  encrypted: { id: string; data: string }[],
  decrypted: DecryptedEvent[],
  bucketKey: CryptoKey,
) => {
  const raw = new Map(encrypted.map((e) => [e.id, e.data]));
  return Promise.all(
    decrypted.map(async (ev) => ({
      id: ev.id,
      data: raw.get(ev.id)!,
      updatedAt: ev.updatedAt,
      buckets: await computeEventBuckets(ev.data, bucketKey),
      event: { ...ev.data, timestamp: ev.updatedAt },
    })),
  );
};

export const useCalendarEvents = (
  user: User | null,
  masterKey: CryptoKey | null,
  bucketKey: CryptoKey | null,
) => {
  const [saving, setSaving] = useState(false);
  const { get: getStored, set: setStored, ready } = useStorage();
  const { post } = useApi();

  const [cache] = useState(createEventCache);
  const [cacheQueue] = useState(createSerialQueue);
  const [saveQueue] = useState(createSerialQueue);
  const masterKeyRef = useRef(masterKey);
  useEffect(() => {
    masterKeyRef.current = masterKey;
  }, [masterKey]);

  useEffect(() => {
    if (ready && getStored("cachedEvents")) setStored("cachedEvents", null);
  }, [ready, getStored, setStored]);

  const readCache = useCallback(
    async <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await read();
      } catch {
        toast.warning(t("events.cacheDecryptFailed"));
        await cache.clear().catch(() => {});
        return fallback;
      }
    },
    [cache],
  );

  const syncBucketsNow = useCallback(
    async (
      buckets: string[],
      masterKey: CryptoKey,
      bucketKey: CryptoKey,
    ): Promise<CalendarEvent[]> => {
      const index = await readCache(
        () => cache.readIndex(buckets, masterKey),
        new Map(buckets.map((b) => [b, []])),
      );
      const idsIn = (bucketIds: string[]) => [
        ...new Set(bucketIds.flatMap((b) => index.get(b)!.map((e) => e.id))),
      ];

      let mismatched = buckets;
      if (idsIn(buckets).length > 0) {
        const hashRes = await post<EventHashResponse>("calendar/events/sync", {
          hashes: Object.fromEntries(
            await Promise.all(
              buckets.map(async (b) => [
                b,
                await computeBucketHash(index.get(b)!),
              ]),
            ),
          ),
        } satisfies EventHashRequest);

        if (!hashRes.success || !hashRes.data) {
          throw new Error(
            t(hashRes.message ? "events.syncFailedWith" : "events.syncFailed", {
              message: hashRes.message,
            }),
          );
        }

        mismatched = hashRes.data.mismatched;
        if (mismatched.length === 0) {
          return readCache(() => cache.events(idsIn(buckets), masterKey), []);
        }
      }

      const known = new Map(
        mismatched.flatMap((b) => index.get(b)!.map((e) => [e.id, e.ts])),
      );

      const request: EventSyncRequest = {
        records: Array.from(known, ([id, ts]) => ({
          id: uuidToBase64(id),
          ts,
        })),
        buckets: mismatched,
      };

      // request sync from server, providing a map of our cached events
      const res = await post<EventSyncResponse>(
        "calendar/events/sync",
        request,
      );

      if (!res.success || !res.data) {
        throw new Error(
          t(res.message ? "events.syncFailedWith" : "events.syncFailed", {
            message: res.message,
          }),
        );
      }

      // the server tells us which events were updated, added, and deleted
      const { updated, added, deleted } = res.data;
      deleteDescriptionSizes(deleted);

      try {
        const incoming = [...updated, ...added];
        const upserts = await toUpserts(
          incoming,
          await decryptEvents(incoming, masterKey),
          bucketKey,
        );

        await readCache(
          () => cache.apply(upserts, deleted, masterKey),
          undefined,
        );

        // a mismatch with nothing to pull means the server copy is stale, so re-save ours
        const nothingToApply =
          !updated.length && !added.length && !deleted.length;
        if (nothingToApply && known.size > 0) {
          cache
            .events([...known.keys()], masterKey)
            .then((events) => encryptEvents(events, masterKey, bucketKey))
            .then((encrypted) =>
              post(
                "calendar/events/save",
                encrypted.map((record) => ({ type: "updated", record })),
              ),
            )
            .catch(() => {});
        }

        const synced = await cache.readIndex(buckets, masterKey);
        return await cache.events(
          buckets.flatMap((b) => synced.get(b)!.map((e) => e.id)),
          masterKey,
        );
      } catch {
        toast.error(t("events.decryptFailed"));
        return [];
      }
    },
    [post, cache, readCache],
  );

  const syncBuckets = useCallback(
    (buckets: string[], masterKey: CryptoKey, bucketKey: CryptoKey) =>
      cacheQueue(() => syncBucketsNow(buckets, masterKey, bucketKey)),
    [cacheQueue, syncBucketsNow],
  );

  const applyChanges = useCallback(
    (changes: StreamChange[], masterKey: CryptoKey, bucketKey: CryptoKey) =>
      cacheQueue(async () => {
        const deleted = changes.flatMap((c) =>
          c.type === "deleted" ? [c.id] : [],
        );
        const incoming = await decryptEvents(
          changes.filter((c) => c.type !== "deleted"),
          masterKey,
        );
        const known = new Map(
          (await cache.records(incoming.map((ev) => ev.id)))
            .filter((r) => !deleted.includes(r.id))
            .map((r) => [r.id, r.updatedAt]),
        );
        const fresh = incoming.filter(
          (ev) => (known.get(ev.id) ?? -Infinity) < ev.updatedAt,
        );
        const upserts = await toUpserts(
          changes.filter((c) => c.type !== "deleted"),
          fresh,
          bucketKey,
        );

        // the user may have locked or switched accounts while this was running
        if (masterKeyRef.current === masterKey) {
          await cache.apply(upserts, deleted, masterKey);
        }
        return upserts.map((u) => u.event);
      }),
    [cacheQueue, cache],
  );

  const syncEvents = useCallback(
    async (
      user: User,
      masterKey: CryptoKey,
      bucketKey: CryptoKey,
      currentDate: DateTime,
    ): Promise<CalendarEvent[]> => {
      if (user.type !== "online")
        throw new Error("Cannot syncEvents for offline user.");

      const requestedBuckets = await computeSyncRangeBuckets(
        currentDate,
        bucketKey,
      );

      return syncBuckets(requestedBuckets, masterKey, bucketKey);
    },
    [syncBuckets],
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
          return await readCache(() => cache.allEvents(masterKey), []);
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
    [getStored, syncEvents, readCache, cache],
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
          if (!bucketKey) return;

          changes = changes as EventChange[];
          // encrypt only added/updated events
          const toEncrypt = changes
            .filter((c) => c.type !== "deleted")
            .map((c) => withoutPrivateKeys(c.event!));
          const encryptedEvents = await encryptEvents(
            toEncrypt,
            masterKey,
            bucketKey,
          );

          const oversized = new Set(
            encryptedEvents
              .filter(
                (e) => base64ByteLength(e.data) > MAX_ENCRYPTED_EVENT_BYTES,
              )
              .map((e) => e.id),
          );

          if (oversized.size > 0) {
            const cached = await cache
              .events([...oversized], masterKey)
              .catch(() => []);
            const rejected = rejectOversized(changes, oversized, cached);

            changes = changes.filter(
              (c) => c.type === "deleted" || !oversized.has(c.event!.id),
            );

            if (rejected.length > 0) {
              toast.error(
                t(
                  rejected.length === 1
                    ? "events.tooLarge"
                    : "events.tooLargeMany",
                  { count: rejected.length, title: rejected[0].title },
                ),
              );
            }
            onRejected?.(rejected);

            if (changes.length === 0) {
              setSaving(false);
              cb();
              return;
            }
          }

          // build a map of (eventId: encryptedEvent) for quick lookup
          const encryptedMap = new Map(encryptedEvents.map((e) => [e.id, e]));

          // prepare payload with encrypted events and deleted IDs
          const payload = changes.map((c) => {
            if (c.type === "deleted") return { type: "deleted", id: c.id };
            if (c.type === "added" || c.type === "updated") {
              const enc = encryptedMap.get(c.event!.id)!;
              return { type: c.type, record: enc };
            }
          });

          const trySave = async () => {
            const res = await post(
              "calendar/events/save?c=" + CLIENT_ID,
              payload,
            );

            if (!res.success) {
              toast.error(
                t(res.message ? "events.saveFailedWith" : "events.saveFailed", {
                  message: res.message,
                }),
              );
              setSaving(false);
              return;
            }

            setSaving(false);
            cb();
          };

          await trySave();
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
    [masterKey, bucketKey, post, cache, setStored, user?.type],
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
    applyChanges,
    saveEvents,
    saving,
  };
};
