import type {
  CalendarEvent,
  DecryptedEvent,
  EncryptedEvent,
  RawCalendarEvent,
} from "@/types/calendar/Event";
import type { APIResponse } from "@/types/API";
import { DateTime } from "luxon";
import { encrypt, decrypt } from "../crypt";
import {
  arrayBufferToBase64,
  uint8ArrayFromBase64,
  withoutRuntimeFields,
} from "../utils";
import { computeEventBuckets } from "./buckets";

// mirrors the server's constants.MaxEventLen (bytes of ciphertext)
export const MAX_ENCRYPTED_EVENT_BYTES = 10000;

const decryptEvent = async (ev: EncryptedEvent, masterKey: CryptoKey) => {
  const raw = withoutRuntimeFields(
    JSON.parse(
      new TextDecoder().decode(
        await decrypt(uint8ArrayFromBase64(ev.data), masterKey),
      ),
    ) as RawCalendarEvent,
  );

  if (raw.id?.toLowerCase() !== ev.id.toLowerCase()) {
    console.warn("Ignoring an event stored under a different id");
    return null;
  }

  return {
    ...ev,
    data: cookEvent(raw),
  } as DecryptedEvent;
};

const decryptEventOrSkip = (ev: EncryptedEvent, masterKey: CryptoKey) =>
  decryptEvent(ev, masterKey).catch(() => {
    console.warn("Ignoring an event that cannot be decrypted");
    return null;
  });

export const decryptEvents = async (
  events: EncryptedEvent[],
  masterKey: CryptoKey,
) => {
  const decrypted = await Promise.all(
    events.map((ev) => decryptEvent(ev, masterKey)),
  );

  return decrypted.filter((ev) => ev !== null);
};

export const decryptSpaceEvents: typeof decryptEvents = async (
  events,
  spaceKey,
) => {
  const decrypted = await Promise.all(
    events.map((ev) => decryptEventOrSkip(ev, spaceKey)),
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
        encrypt(
          new TextEncoder().encode(JSON.stringify(withoutRuntimeFields(ev))),
          masterKey,
        ).then(arrayBufferToBase64),
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

export const cookEvent = (event: RawCalendarEvent): CalendarEvent =>
  ({
    ...event,
    start: DateTime.fromISO(event.start),
    end: DateTime.fromISO(event.end),
  }) as CalendarEvent;

export type ApiPost = <T>(
  endpoint: string,
  body: unknown,
) => Promise<APIResponse<T>>;
