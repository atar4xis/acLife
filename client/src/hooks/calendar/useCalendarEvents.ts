import { useApi } from "@/context/ApiContext";
import { useStorage } from "@/context/StorageContext";
import {
  decryptOfflineEvents,
  decryptEvents,
  encryptOfflineEvents,
  encryptEvents,
  MAX_ENCRYPTED_EVENT_BYTES,
} from "@/lib/calendar/crypt";
import {
  computeBucketHash,
  computeBucketId, // TODO: temporary migration, remove before v1
  computeEventBuckets,
  computeSyncRangeBuckets,
  eventBucketLabels, // TODO: temporary migration, remove before v1
  RECURRING_BUCKET_LABEL, // TODO: temporary migration, remove before v1
} from "@/lib/calendar/buckets";
import { base64ByteLength, uuidToBase64 } from "@/lib/utils";
import type {
  CalendarEvent,
  EventHashRequest,
  EventHashResponse,
  EventSyncRequest,
  EventSyncResponse,
  EventChange,
  RejectedEvent,
  WithoutPrivateKeys,
} from "@/types/calendar/Event";
import type { User } from "@/types/User";
import type { DateTime } from "luxon";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CLIENT_ID } from "@/lib/clientId";
import { createSerialQueue } from "@/lib/serialQueue";
import type { CalendarChange } from "@/lib/stream";
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

// corrupted entries are dropped so the sync diff re-requests them fresh from the server
const decryptValid = async (
  stored: Parameters<typeof decryptOfflineEvents>[0],
  masterKey: CryptoKey,
) =>
  (await decryptOfflineEvents(stored, masterKey)).filter(
    (ev) => ev.start.isValid && ev.end.isValid,
  );

export const useCalendarEvents = (
  user: User | null,
  masterKey: CryptoKey | null,
  bucketKey: CryptoKey | null,
) => {
  const [saving, setSaving] = useState(false);
  const { get: getStored, set: setStored } = useStorage();
  const { post } = useApi();

  const [cacheQueue] = useState(createSerialQueue);
  const [saveQueue] = useState(createSerialQueue);
  const masterKeyRef = useRef(masterKey);
  useEffect(() => {
    masterKeyRef.current = masterKey;
  }, [masterKey]);

  const getCachedEvents = useCallback(
    async (masterKey: CryptoKey): Promise<CalendarEvent[]> => {
      const cached = getStored("cachedEvents");
      const cachedEvents: CalendarEvent[] = [];

      if (cached) {
        try {
          cachedEvents.push(...(await decryptValid(cached, masterKey)));
        } catch {
          toast.warning(t("events.cacheDecryptFailed"));
        }
      }

      return cachedEvents;
    },
    [getStored],
  );

  const syncBucketsNow = useCallback(
    async (
      buckets: string[],
      masterKey: CryptoKey,
      bucketKey: CryptoKey,
    ): Promise<CalendarEvent[]> => {
      // get cached events
      const cachedEvents = await getCachedEvents(masterKey);

      const byBucket = new Map<string, CalendarEvent[]>(
        buckets.map((b) => [b, []]),
      );
      await Promise.all(
        cachedEvents.map(async (ev) => {
          for (const b of await computeEventBuckets(ev, bucketKey)) {
            byBucket.get(b)?.push(ev);
          }
        }),
      );

      let mismatched = buckets;
      if (cachedEvents.length > 0) {
        const hashRes = await post<EventHashResponse>("calendar/events/sync", {
          hashes: Object.fromEntries(
            await Promise.all(
              buckets.map(async (b) => [
                b,
                await computeBucketHash(
                  byBucket
                    .get(b)!
                    .map((ev) => ({ id: ev.id, ts: ev.timestamp })),
                ),
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
        if (mismatched.length === 0) return cachedEvents;
      }

      const eventsToSync = new Set(
        mismatched.flatMap((b) => byBucket.get(b) ?? []),
      );

      const request: EventSyncRequest = {
        events: Array.from(eventsToSync).map((ev) => ({
          id: uuidToBase64(ev.id),
          ts: ev.timestamp,
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
      const { updated, added, deleted, needsBucketBackfill } = res.data;

      // remove deleted events from cache
      const cachedMap = new Map(cachedEvents.map((ev) => [ev.id, ev]));
      for (const id of deleted) {
        cachedMap.delete(id);
      }

      // decrypt updated and added event data
      try {
        const [decryptedUpdated, decryptedAdded] = await Promise.all([
          decryptEvents(updated, masterKey),
          decryptEvents(added, masterKey),
        ]);

        // merge decrypted events into cachedMap
        for (const ev of [...decryptedUpdated, ...decryptedAdded]) {
          cachedMap.set(ev.id, { ...ev.data, timestamp: ev.updatedAt });
        }

        const finalEvents = Array.from(cachedMap.values());

        // save the new cache
        setStored(
          "cachedEvents",
          await encryptOfflineEvents(finalEvents, masterKey),
        );

        const backfillIds = new Set(needsBucketBackfill ?? []);
        const nothingToApply =
          !updated.length && !added.length && !deleted.length;
        if (nothingToApply) {
          for (const b of mismatched) {
            for (const ev of byBucket.get(b) ?? []) backfillIds.add(ev.id);
          }
        }

        // TODO: temporary migration, remove before v1
        const recurringBucket = await computeBucketId(
          bucketKey,
          RECURRING_BUCKET_LABEL,
        );
        if (mismatched.includes(recurringBucket)) {
          for (const ev of cachedMap.values()) {
            if (
              ev.repeat &&
              !eventBucketLabels(ev).includes(RECURRING_BUCKET_LABEL)
            ) {
              backfillIds.add(ev.id);
            }
          }
        }

        if (backfillIds.size > 0) {
          const toBackfill = [...backfillIds]
            .map((id) => cachedMap.get(id))
            .filter((ev): ev is CalendarEvent => ev !== undefined);

          if (toBackfill.length > 0) {
            encryptEvents(toBackfill, masterKey, bucketKey)
              .then((encrypted) =>
                post(
                  "calendar/events/save",
                  encrypted.map((event) => ({ type: "updated", event })),
                ),
              )
              .catch(() => {});
          }
        }

        return finalEvents;
      } catch {
        toast.error(t("events.decryptFailed"));
        return [];
      }
    },
    [post, setStored, getCachedEvents],
  );

  const syncBuckets = useCallback(
    (buckets: string[], masterKey: CryptoKey, bucketKey: CryptoKey) =>
      cacheQueue(() => syncBucketsNow(buckets, masterKey, bucketKey)),
    [cacheQueue, syncBucketsNow],
  );

  const applyChanges = useCallback(
    (changes: CalendarChange[], masterKey: CryptoKey) =>
      cacheQueue(async () => {
        const cachedMap = new Map(
          (await getCachedEvents(masterKey)).map((ev) => [ev.id, ev]),
        );
        const upserts = [];

        for (const c of changes) {
          if (c.type === "deleted") cachedMap.delete(c.id);
          else upserts.push(c);
        }

        for (const ev of await decryptEvents(upserts, masterKey)) {
          const known = cachedMap.get(ev.id);
          if (!known || known.timestamp < ev.updatedAt) {
            cachedMap.set(ev.id, { ...ev.data, timestamp: ev.updatedAt });
          }
        }

        const events = Array.from(cachedMap.values());
        // the user may have locked or switched accounts while this was running
        if (masterKeyRef.current !== masterKey) return events;
        setStored(
          "cachedEvents",
          await encryptOfflineEvents(events, masterKey),
        );
        return events;
      }),
    [cacheQueue, getCachedEvents, setStored],
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
          return await getCachedEvents(masterKey);
        }
      }

      // for offline users, we just decrypt from storage
      try {
        const events = getStored("offlineEvents");
        return events ? await decryptOfflineEvents(events, masterKey) : [];
      } catch {
        toast.error(t("events.decryptFailed"));
        return [];
      }
    },
    [getStored, syncEvents, getCachedEvents],
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
            const stored = getStored("cachedEvents");
            const cached = stored
              ? await decryptValid(stored, masterKey).catch(() => [])
              : [];
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
              return { type: c.type, event: enc };
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
          const encrypted = await encryptOfflineEvents(allEvents, masterKey);

          setStored("offlineEvents", encrypted);

          setSaving(false);
          cb();
        }
      } catch {
        toast.error(t("events.saveFailed"));
        setSaving(false);
      }
    },
    [masterKey, bucketKey, post, getStored, setStored, user?.type],
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
