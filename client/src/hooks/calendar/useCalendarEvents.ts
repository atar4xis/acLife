import { useApi } from "@/context/ApiContext";
import { useStorage } from "@/context/StorageContext";
import {
  decryptOfflineEvents,
  decryptEvents,
  encryptOfflineEvents,
  encryptEvents,
} from "@/lib/calendar/crypt";
import { uuidToBase64 } from "@/lib/utils";
import type {
  CalendarEvent,
  EventSyncResponse,
  EventChange,
} from "@/types/calendar/Event";
import type { User } from "@/types/User";
import { useCallback, useState } from "react";
import { toast } from "sonner";

export const CLIENT_ID = Math.random().toString(36).slice(2, 8);

export const useCalendarEvents = (
  user: User | null,
  masterKey: CryptoKey | null,
) => {
  const [saving, setSaving] = useState(false);
  const storage = useStorage();
  const { post } = useApi();

  const syncEvents = useCallback(
    async (user: User, masterKey: CryptoKey): Promise<CalendarEvent[]> => {
      if (!storage) return [];

      if (user.type !== "online")
        throw new Error("Cannot syncEvents for offline user.");

      // get cached events
      const cached = storage.get("cachedEvents");
      const cachedEvents: CalendarEvent[] = [];

      if (cached) {
        try {
          const decryptedCache = await decryptOfflineEvents(cached, masterKey);
          cachedEvents.push(...decryptedCache);
        } catch {
          toast.warning("Failed to decrypt event cache - it'll be discarded.");
        }
      }

      // request sync from server, providing a map of our cached events
      const res = await post<EventSyncResponse>(
        "calendar/events/sync",
        cachedEvents.map((ev) => ({
          id: uuidToBase64(ev.id),
          ts: ev.timestamp,
        })),
      );

      if (!res.success || !res.data) {
        toast.error("Failed to sync calendar events.");
        throw new Error("Failed to sync calendar events.");
      }

      // the server tells us which events were updated, added, and deleted
      const { updated, added, deleted } = res.data;

      // remove deleted events from cache
      const cachedMap = new Map(cachedEvents.map((ev) => [ev.id, ev]));
      for (const id of deleted) {
        cachedMap.delete(id);
      }

      // decrypt updated and added event data
      try {
        const decryptedUpdated = await decryptEvents(updated, masterKey);
        const decryptedAdded = await decryptEvents(added, masterKey);

        // merge decrypted events into cachedMap
        for (const ev of decryptedUpdated) {
          cachedMap.set(ev.id, ev.data);
        }
        for (const ev of decryptedAdded) {
          cachedMap.set(ev.id, ev.data);
        }

        const finalEvents = Array.from(cachedMap.values());

        // save the new cache
        storage.set(
          "cachedEvents",
          await encryptOfflineEvents(finalEvents, masterKey),
        );

        return finalEvents;
      } catch {
        toast.error("Failed to decrypt calendar events.");
        return [];
      }
    },
    [post, storage],
  );

  const loadEvents = useCallback(
    async (user: User, masterKey: CryptoKey): Promise<CalendarEvent[]> => {
      if (!storage) return [];

      // for online users, we sync events with the server
      if (user.type === "online") {
        return syncEvents(user, masterKey);
      }

      // for offline users, we just decrypt from storage
      try {
        const events = storage.get("offlineEvents");
        return events ? await decryptOfflineEvents(events, masterKey) : [];
      } catch {
        toast.error("Failed to decrypt calendar events.");
        return [];
      }
    },
    [storage, syncEvents],
  );

  const saveEvents = useCallback(
    async (changes: EventChange[] | CalendarEvent[], cb: () => void) => {
      if (!changes || changes.length === 0) return;

      setSaving(true);

      try {
        if (!storage || !masterKey) return;

        if (user?.type === "online") {
          changes = changes as EventChange[];
          // encrypt only added/updated events
          const toEncrypt = changes
            .filter((c) => c.type !== "deleted")
            .map((c) => c.event!);
          const encryptedEvents = await encryptEvents(toEncrypt, masterKey);

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
              toast.error("Failed to save calendar events.");
              setSaving(false);
              return;
            }

            // update local cachedEvents with the new encrypted events
            const stored = storage.get("cachedEvents");
            const cached = stored
              ? await decryptOfflineEvents(stored, masterKey)
              : [];

            // build map of (eventId: event) to merge changes easily
            const cachedMap = new Map(
              cached.map((ev: CalendarEvent) => [ev.id, ev]),
            );

            // merge changes
            for (const c of changes as EventChange[]) {
              if (c.type === "deleted") cachedMap.delete(c.id!);
              else cachedMap.set(c.event!.id, c.event!);
            }

            // encrypt new values
            const encryptedEvents = await encryptOfflineEvents(
              Array.from(cachedMap.values()),
              masterKey,
            );

            // store in cache
            storage.set("cachedEvents", encryptedEvents);

            setSaving(false);
            cb();
          };

          await trySave();
        } else {
          // for offline users just encrypt and store all events locally
          const allEvents = changes as CalendarEvent[];
          const encrypted = await encryptOfflineEvents(allEvents, masterKey);

          storage.set("offlineEvents", encrypted);

          setSaving(false);
          cb();
        }
      } catch {
        toast.error("Failed to save calendar events.");
        setSaving(false);
      }
    },
    [masterKey, post, storage, user?.type],
  );

  return { loadEvents, syncEvents, saveEvents, saving };
};
