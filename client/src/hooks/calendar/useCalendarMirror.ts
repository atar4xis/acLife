import { useApi } from "@/context/ApiContext";
import { useShares } from "@/context/ShareContext";
import { withClient } from "@/lib/clientId";
import { computeSyncRangeBuckets } from "@/lib/calendar/buckets";
import { encryptEvents } from "@/lib/calendar/crypt";
import { changeId, covers, MIRROR_BACKFILL_WEEKS } from "@/lib/calendar/shared";
import {
  BACKFILL_BUCKET_CHUNK,
  BACKFILL_SAVE_CHUNK,
  eventsNewerThan,
  noAdoptedChanges,
  personalSource,
  upsertsFromSaved,
  syncError,
  updatedAtById,
  type CalendarSource,
  type MirroredSpace,
  type SourceSaver,
  type AdoptedChanges,
  type SourceSyncer,
} from "@/lib/calendar/sources";
import type { EventCache } from "@/lib/calendar/eventCache";
import { createSerialQueue } from "@/lib/serialQueue";
import { onStream } from "@/lib/stream";
import { syncPart } from "@/lib/syncBatch";
import type {
  CalendarEvent,
  EventChange,
  EventExistsRequest,
  EventMissingResponse,
} from "@/types/calendar/Event";
import type { OwnedSpace } from "@/types/Share";
import type { User } from "@/types/User";
import { DateTime } from "luxon";
import { useCallback, useEffect, useState } from "react";

export const useCalendarMirror = ({
  cache,
  cacheQueue,
  mirrors,
  user,
  masterKey,
  bucketKey,
  syncSourceNow,
  saveTo,
}: {
  cache: EventCache;
  cacheQueue: ReturnType<typeof createSerialQueue>;
  mirrors: MirroredSpace[];
  user: User | null;
  masterKey: CryptoKey | null;
  bucketKey: CryptoKey | null;
  syncSourceNow: SourceSyncer;
  saveTo: SourceSaver;
}) => {
  const { post } = useApi();
  const { deleteSpace } = useShares();
  const [backfilled] = useState(() => new Set<string>());
  const [mirrorSynced] = useState(() => new Map<string, Set<string>>());
  // ids deleted locally whose delete has not reached the space yet, so a pull does not bring them back
  const [unmirroredDeletes] = useState(() => new Set<string>());

  useEffect(() => onStream("sync", () => mirrorSynced.clear()), [mirrorSynced]);

  const adoptIntoOwn = useCallback(
    async (
      space: OwnedSpace,
      incoming: CalendarEvent[],
      incomingDeleted: string[],
      masterKey: CryptoKey,
      bucketKey: CryptoKey,
      adopted: AdoptedChanges = { events: [], deletedIds: [] },
    ) => {
      // edits other members make in a mirrored space are copied into the owner's own calendar
      const events = incoming.filter(
        (ev) => covers(space, ev.id) && !unmirroredDeletes.has(ev.id),
      );
      const deletedIds = incomingDeleted.filter((id) => covers(space, id));
      const ownRecords = await updatedAtById(
        cache,
        events.map((ev) => ev.id),
      );
      const newer = eventsNewerThan(ownRecords, events);
      const existing = (await cache.records(deletedIds)).map((r) => r.id);

      if (newer.length > 0) {
        const encrypted = await encryptEvents(newer, masterKey, bucketKey);
        const saved = await post(
          withClient("calendar/events/save"),
          encrypted.map((record) => ({
            type: ownRecords.has(record.id) ? "updated" : "added",
            record,
          })),
        );
        if (!saved.success) throw new Error("Adopting shared edits failed.");

        await cache.apply(
          await upsertsFromSaved(newer, encrypted, bucketKey),
          [],
          masterKey,
        );
        adopted.events = newer;
      }

      if (existing.length > 0) {
        const removed = await post(
          withClient("calendar/events/save"),
          existing.map((id) => ({ type: "deleted", id })),
        );
        if (!removed.success)
          throw new Error("Adopting shared deletes failed.");

        await cache.apply([], existing, masterKey);
        adopted.deletedIds = existing;
      }

      return adopted;
    },
    [cache, post, unmirroredDeletes],
  );

  const missingFrom = useCallback(
    async (space: OwnedSpace, ids: string[]) => {
      const covered = ids.filter((id) => covers(space, id));
      if (covered.length === 0) return covered;

      const res = await syncPart<EventMissingResponse>(
        post,
        "calendar/events/sync",
        space.id,
        { exists: covered } satisfies EventExistsRequest,
      );
      if (!res.success || !res.data) throw syncError(res);

      return res.data.missing;
    },
    [post],
  );

  const pullMirror = useCallback(
    async (
      space: OwnedSpace,
      source: CalendarSource,
      buckets: string[],
      masterKey: CryptoKey,
      bucketKey: CryptoKey,
    ) => {
      const gone: string[] = [];
      const adopted: AdoptedChanges = { events: [], deletedIds: [] };

      try {
        const events = await syncSourceNow(source, buckets, (ids) =>
          gone.push(...ids),
        );
        await adoptIntoOwn(
          space,
          events,
          await missingFrom(space, gone),
          masterKey,
          bucketKey,
          adopted,
        );
        const synced = mirrorSynced.get(space.id) ?? new Set<string>();
        buckets.forEach((bucket) => synced.add(bucket));
        mirrorSynced.set(space.id, synced);
        return adopted;
      } catch {
        return adopted;
      }
    },
    [syncSourceNow, missingFrom, adoptIntoOwn, mirrorSynced],
  );

  const pullStale = useCallback(
    async (
      masterKey: CryptoKey,
      bucketKey: CryptoKey,
      weeks: (key: CryptoKey) => Promise<string[]>,
    ): Promise<AdoptedChanges> => {
      const pulled = await Promise.all(
        mirrors.map(async ({ space, source }) => {
          const synced = mirrorSynced.get(space.id);
          const stale = (await weeks(source.bucketKey)).filter(
            (bucket) => !synced?.has(bucket),
          );
          if (stale.length === 0) return noAdoptedChanges;

          return pullMirror(space, source, stale, masterKey, bucketKey);
        }),
      );

      return {
        events: pulled.flatMap((result) => result.events),
        deletedIds: pulled.flatMap((result) => result.deletedIds),
      };
    },
    [mirrors, mirrorSynced, pullMirror],
  );

  const mirrorOut = useCallback(
    async (changes: EventChange[]) => {
      let ok = true;

      for (const { space, source } of mirrors) {
        const covered = changes.filter((c) => covers(space, changeId(c)));
        if (covered.length === 0) continue;

        // delete space when nothing left to share
        const itemDeleted =
          space.target !== null && covered.some((c) => c.type === "deleted");
        if (itemDeleted) {
          ok = (await deleteSpace(space.id)) && ok;
          continue;
        }

        const have = await updatedAtById(source.cache, covered.map(changeId));
        const fresh = covered.filter(
          (c) =>
            c.type === "deleted" ||
            c.event!.timestamp > (have.get(c.event!.id) ?? -Infinity),
        );
        if (fresh.length > 0) {
          const deletedIds = fresh
            .filter((c) => c.type === "deleted")
            .map(changeId);
          deletedIds.forEach((id) => unmirroredDeletes.add(id));

          const saved = await saveTo(source, fresh).catch(() => null);
          if (saved) deletedIds.forEach((id) => unmirroredDeletes.delete(id));
          ok = !!saved && ok;
        }
      }

      return ok;
    },
    [mirrors, saveTo, deleteSpace, unmirroredDeletes],
  );

  const backfill = useCallback(
    async (
      space: OwnedSpace,
      source: CalendarSource,
      masterKey: CryptoKey,
      bucketKey: CryptoKey,
    ) => {
      // copy the owner's existing events into the space, later changes go through mirrorOut
      const ownSourceNow = personalSource(cache, masterKey, bucketKey);

      const candidates: CalendarEvent[] = [];
      if (space.target !== null) {
        candidates.push(...(await cache.events([space.target], masterKey)));
      } else {
        const labels = await computeSyncRangeBuckets(
          DateTime.now(),
          bucketKey,
          MIRROR_BACKFILL_WEEKS,
        );
        for (
          let from = 0;
          from < labels.length;
          from += BACKFILL_BUCKET_CHUNK
        ) {
          candidates.push(
            ...(await syncSourceNow(
              ownSourceNow,
              labels.slice(from, from + BACKFILL_BUCKET_CHUNK),
            )),
          );
        }
      }

      const unique = [...new Map(candidates.map((ev) => [ev.id, ev])).values()];
      const have = await updatedAtById(
        source.cache,
        unique.map((ev) => ev.id),
      );
      const missing = eventsNewerThan(have, unique);

      for (let from = 0; from < missing.length; from += BACKFILL_SAVE_CHUNK) {
        const chunk = missing.slice(from, from + BACKFILL_SAVE_CHUNK);
        const saved = await saveTo(
          source,
          chunk.map((event) => ({ type: "updated", event })),
        );
        if (!saved) throw new Error("Backfill failed.");
        if (saved.dropped) return;
        if (saved.changes.length === 0) continue;

        const sent = saved.changes.map((c) => c.event!);
        await source.cache.apply(
          await upsertsFromSaved(sent, saved.encrypted, source.bucketKey),
          [],
          source.key,
        );
      }
    },
    [cache, saveTo, syncSourceNow],
  );

  useEffect(() => {
    if (!masterKey || !bucketKey || user?.type !== "online") return;

    for (const { space, source } of mirrors) {
      // one backfill per space, retried only after a failure
      if (backfilled.has(space.id)) continue;
      backfilled.add(space.id);

      cacheQueue(async () => {
        try {
          await backfill(space, source, masterKey, bucketKey);
        } catch {
          backfilled.delete(space.id);
        }
      });
    }
  }, [
    mirrors,
    masterKey,
    bucketKey,
    user?.type,
    backfilled,
    cacheQueue,
    backfill,
  ]);

  return { adoptIntoOwn, pullStale, mirrorOut };
};
