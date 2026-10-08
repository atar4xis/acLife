import { encryptEvents } from "../../src/lib/calendar/crypt.ts";
import { createEventCache } from "../../src/lib/calendar/eventCache.ts";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";

export const seedCache = async (
  events: CalendarEvent[],
  masterKey: CryptoKey,
  bucketKey: CryptoKey,
) => {
  const upserts = await Promise.all(
    events.map(async (event) => {
      const [enc] = await encryptEvents([event], masterKey, bucketKey);
      return {
        id: enc.id,
        data: enc.data,
        updatedAt: enc.updatedAt,
        buckets: enc.buckets!,
        event,
      };
    }),
  );
  await createEventCache().apply(upserts, [], masterKey);
};

export const cachedEvents = (masterKey: CryptoKey) =>
  createEventCache().allEvents(masterKey);
