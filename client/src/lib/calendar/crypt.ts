import type {
  CalendarEvent,
  DecryptedEvent,
  EncryptedEvent,
  RawCalendarEvent,
} from "@/types/calendar/Event";
import type { Encrypted } from "@/types/Crypt";
import type { APIResponse } from "@/types/API";
import { DateTime } from "luxon";
import { encrypt, decrypt } from "../crypt";
import { compress, decompress } from "../gzip";
import { arrayBufferToBase64, uint8ArrayFromBase64 } from "../utils";
import { computeEventBuckets } from "./buckets";

// mirrors the server's constants.MaxEventLen (bytes of ciphertext)
export const MAX_ENCRYPTED_EVENT_BYTES = 10000;

export const encryptOfflineEvents = async (
  events: CalendarEvent[],
  masterKey: CryptoKey,
): Promise<Encrypted> => {
  const payload = new TextEncoder().encode(JSON.stringify(events));
  const compressed = await compress(payload);
  return encrypt(compressed, masterKey);
};

const MAX_TIMESTAMP_DRIFT_MS = 1000;

export const decryptEvents = async (
  events: EncryptedEvent[],
  masterKey: CryptoKey,
) => {
  const decrypted = await Promise.all(
    events.map(async (ev) => {
      const raw = JSON.parse(
        new TextDecoder().decode(
          await decrypt(uint8ArrayFromBase64(ev.data), masterKey),
        ),
      ) as RawCalendarEvent;

      if (raw.id?.toLowerCase() !== ev.id.toLowerCase()) {
        console.warn("Ignoring an event stored under a different id");
        return null;
      }

      if (Math.abs(raw.timestamp - ev.updatedAt) > MAX_TIMESTAMP_DRIFT_MS) {
        console.warn("Ignoring an event whose timestamp does not match");
        return null;
      }

      return {
        ...ev,
        // data contains an entire CalendarEvent object after decryption
        data: cookEvent(raw),
      } as DecryptedEvent;
    }),
  );

  return decrypted.filter((ev) => ev !== null);
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

export type ApiPost = <T>(
  endpoint: string,
  body: unknown,
) => Promise<APIResponse<T>>;
