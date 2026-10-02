import { useApi } from "@/context/ApiContext";
import { useStorage } from "@/context/StorageContext";
import {
  decryptOfflineEvents,
  decryptEvents,
  encryptOfflineEvents,
  encryptEvents,
} from "@/lib/calendar/crypt";
import {
  computeBucketHash,
  computeEventBuckets,
  computeSyncRangeBuckets,
} from "@/lib/calendar/buckets";
import { uuidToBase64 } from "@/lib/utils";
import type {
  CalendarEvent,
  EventHashRequest,
  EventHashResponse,
  EventSyncRequest,
  EventSyncResponse,
  EventChange,
  WithoutPrivateKeys,
} from "@/types/calendar/Event";
import type { User } from "@/types/User";
import type { DateTime } from "luxon";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { CLIENT_ID } from "@/lib/clientId";

const withoutPrivateKeys = (event: CalendarEvent) =>
  Object.fromEntries(
    Object.entries(event).filter(([key]) => !key.startsWith("_")),
  ) as WithoutPrivateKeys<CalendarEvent>;

export const useCalendarEvents = (
  user: User | null,
  masterKey: CryptoKey | null,
  bucketKey: CryptoKey | null,
) => {
  const [saving, setSaving] = useState(false);
  const { get: getStored, set: setStored } = useStorage();
  const { post } = useApi();

  const getCachedEvents = useCallback(
    async (masterKey: CryptoKey): Promise<CalendarEvent[]> => {
      const cached = getStored("cachedEvents");
      const cachedEvents: CalendarEvent[] = [];

      if (cached) {
        try {
          const decryptedCache = await decryptOfflineEvents(cached, masterKey);
          // drop corrupted entries so the sync diff re-requests them fresh from the server
          cachedEvents.push(
            ...decryptedCache.filter(
              (ev) => ev.start.isValid && ev.end.isValid,
            ),
          );
        } catch {
          toast.warning("Failed to decrypt event cache - it'll be discarded.");
        }
      }

      return cachedEvents;
    },
    [getStored],
  );

  const syncBuckets = useCallback(
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

      const hashRes = await post<EventHashResponse>("calendar/events/sync", {
        hashes: Object.fromEntries(
          await Promise.all(
            buckets.map(async (b) => [
              b,
              await computeBucketHash(
                byBucket.get(b)!.map((ev) => ({ id: ev.id, ts: ev.timestamp })),
              ),
            ]),
          ),
        ),
      } satisfies EventHashRequest);

      if (!hashRes.success || !hashRes.data) {
        throw new Error(
          "Failed to sync calendar events" +
            (hashRes.message ? `: ${hashRes.message}` : "."),
        );
      }

      const { mismatched } = hashRes.data;
      if (mismatched.length === 0) return cachedEvents;

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
          "Failed to sync calendar events" +
            (res.message ? `: ${res.message}` : "."),
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

        if (needsBucketBackfill?.length > 0) {
          const toBackfill = needsBucketBackfill
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
        toast.error("Failed to decrypt calendar events.");
        return [];
      }
    },
    [post, setStored, getCachedEvents],
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
        toast.error("Failed to decrypt calendar events.");
        return [];
      }
    },
    [getStored, syncEvents, getCachedEvents],
  );

  const saveEvents = useCallback(
    async (changes: EventChange[] | CalendarEvent[], cb: () => void) => {
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
                "Failed to save calendar events" +
                  (res.message ? `: ${res.message}` : "."),
              );
              setSaving(false);
              return;
            }

            // update local cachedEvents with the new encrypted events
            const stored = getStored("cachedEvents");
            const cached = stored
              ? (await decryptOfflineEvents(stored, masterKey)).filter(
                  (ev) => ev.start.isValid && ev.end.isValid,
                )
              : [];

            // build map of (eventId: event) to merge changes easily
            const cachedMap = new Map(
              cached.map((ev: CalendarEvent) => [ev.id, ev]),
            );

            // merge changes
            for (const c of changes as EventChange[]) {
              if (c.type === "deleted") cachedMap.delete(c.id!);
              else
                cachedMap.set(
                  c.event!.id,
                  withoutPrivateKeys(c.event!) as CalendarEvent,
                );
            }

            // encrypt new values
            const encryptedEvents = await encryptOfflineEvents(
              Array.from(cachedMap.values()),
              masterKey,
            );

            // store in cache
            setStored("cachedEvents", encryptedEvents);

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
        toast.error("Failed to save calendar events.");
        setSaving(false);
      }
    },
    [masterKey, bucketKey, post, getStored, setStored, user?.type],
  );

  return { loadEvents, syncEvents, syncBuckets, saveEvents, saving };
};
