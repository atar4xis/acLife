import type {
  CalendarEvent,
  DecryptedEvent,
  EncryptedEvent,
  EventSyncResponse,
  RawCalendarEvent,
} from "@/types/calendar/Event";
import type { Encrypted } from "@/types/Crypt";
import type { APIResponse } from "@/types/API";
import { DateTime } from "luxon";
import {
  ArgonType,
  deriveMasterKey,
  encrypt,
  decrypt,
  UNLOCK_CHECK_BYTES,
  type DerivedKeys,
} from "../crypt";
import { compress, decompress } from "../gzip";
import { arrayBufferToBase64, uint8ArrayFromBase64 } from "../utils";
import { computeEventBuckets } from "./buckets";

export const encryptOfflineEvents = async (
  events: CalendarEvent[],
  masterKey: CryptoKey,
): Promise<Encrypted> => {
  const payload = new TextEncoder().encode(JSON.stringify(events));
  const compressed = await compress(payload);
  return encrypt(compressed, masterKey);
};

export const decryptEvents = async (
  events: EncryptedEvent[],
  masterKey: CryptoKey,
) => {
  return Promise.all(
    events.map(async (ev) => {
      const raw = JSON.parse(
        new TextDecoder().decode(
          await decrypt(uint8ArrayFromBase64(ev.data), masterKey),
        ),
      ) as RawCalendarEvent;

      return {
        ...ev,
        // data contains an entire CalendarEvent object after decryption
        data: cookEvent(raw),
      } as DecryptedEvent;
    }),
  );
};

export const encryptEvents = async (
  events: CalendarEvent[],
  masterKey: CryptoKey,
  bucketKey: CryptoKey,
): Promise<EncryptedEvent[]> => {
  return Promise.all(
    events.map(async (ev) => {
      const [data, buckets] = await Promise.all([
        encrypt(new TextEncoder().encode(JSON.stringify(ev)), masterKey).then(
          arrayBufferToBase64,
        ),
        computeEventBuckets(ev, bucketKey),
      ]);

      return {
        id: ev.id,
        updatedAt: ev.timestamp,
        data,
        buckets,
      } as EncryptedEvent;
    }),
  );
};

export const decryptOfflineEvents = async (
  data: Encrypted,
  masterKey: CryptoKey,
): Promise<CalendarEvent[]> => {
  const payload = await decrypt(data, masterKey);
  const decompressed = await decompress(payload);

  const rawEvents = JSON.parse(
    new TextDecoder().decode(decompressed),
  ) as RawCalendarEvent[];

  return rawEvents.map(cookEvent);
};

const cookEvent = (event: RawCalendarEvent): CalendarEvent =>
  ({
    ...event,
    start: DateTime.fromISO(event.start),
    end: DateTime.fromISO(event.end),
  }) as CalendarEvent;

type ApiPost = <T>(endpoint: string, body: unknown) => Promise<APIResponse<T>>;

type CacheStorage = {
  get(key: "cachedEvents"): Encrypted | null;
  set(key: "cachedEvents", value: Encrypted | null): void;
};

export const migrateMasterKeyToArgon2id = async (
  password: string,
  salt: Uint8Array,
  oldMasterKey: CryptoKey,
  post: ApiPost,
  storage?: CacheStorage,
): Promise<DerivedKeys> => {
  const { masterKey: newMasterKey, bucketKey: newBucketKey } =
    await deriveMasterKey(password, salt, false, ArgonType.Argon2id);

  const newChallenge = await encrypt(UNLOCK_CHECK_BYTES, newMasterKey);
  const challengeRes = await post<never>("user/challenge", {
    challenge: arrayBufferToBase64(newChallenge),
  });
  if (!challengeRes.success) {
    throw new Error(
      challengeRes.message || "Failed to update security challenge.",
    );
  }

  // migration needs every event regardless of week
  const syncRes = await post<EventSyncResponse>("calendar/events/sync", {
    events: [],
  });
  if (!syncRes.success || !syncRes.data) {
    throw new Error(
      syncRes.message || "Failed to fetch calendar events for migration.",
    );
  }

  const allEncrypted = [...syncRes.data.added, ...syncRes.data.updated];
  const decryptedEvents =
    allEncrypted.length > 0
      ? (await decryptEvents(allEncrypted, oldMasterKey)).map((ev) => ({
          ...ev.data,
          timestamp: ev.updatedAt,
        }))
      : [];

  if (decryptedEvents.length > 0) {
    const reencrypted = await encryptEvents(
      decryptedEvents,
      newMasterKey,
      newBucketKey,
    );
    const saveRes = await post(
      "calendar/events/save",
      reencrypted.map((event) => ({ type: "updated", event })),
    );
    if (!saveRes.success) {
      throw new Error(
        saveRes.message || "Failed to re-encrypt calendar events.",
      );
    }
  }

  storage?.set(
    "cachedEvents",
    decryptedEvents.length > 0
      ? await encryptOfflineEvents(decryptedEvents, newMasterKey)
      : null,
  );

  return { masterKey: newMasterKey, bucketKey: newBucketKey };
};
