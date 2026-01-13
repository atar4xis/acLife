import type {
  CalendarEvent,
  DecryptedEvent,
  EncryptedEvent,
  RawCalendarEvent,
} from "@/types/calendar/Event";
import type { Encrypted } from "@/types/Crypt";
import { DateTime } from "luxon";
import { encrypt, decrypt } from "../crypt";
import { compress, decompress } from "../gzip";
import { arrayBufferToBase64, uint8ArrayFromBase64 } from "../utils";

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
): Promise<EncryptedEvent[]> => {
  return Promise.all(
    events.map(async (ev) => {
      return {
        id: ev.id,
        updatedAt: ev.timestamp,
        data: arrayBufferToBase64(
          await encrypt(
            new TextEncoder().encode(JSON.stringify(ev)),
            masterKey,
          ),
        ),
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
