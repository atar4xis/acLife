import { Settings } from "luxon";
import type { CalendarEvent, EncryptedEvent } from "@/types/calendar/Event";
import { decrypt, encrypt } from "../crypt";
import { decryptEvents } from "./crypt";

export type CachedEvent = Required<EncryptedEvent>;
export type BucketEntry = { id: string; ts: number };
export type CacheUpsert = CachedEvent & { event: CalendarEvent };

const EVENTS = "events";
const BUCKETS = "buckets";

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const decodeIndex = async (blob: ArrayBuffer, masterKey: CryptoKey) =>
  JSON.parse(
    new TextDecoder().decode(await decrypt(blob, masterKey)),
  ) as BucketEntry[];

const encodeIndex = (entries: BucketEntry[], masterKey: CryptoKey) =>
  encrypt(new TextEncoder().encode(JSON.stringify(entries)), masterKey);

export const createEventCache = (name = "acLifeEventCache") => {
  let opening: Promise<IDBDatabase> | undefined;
  let decoded = new Map<string, { ts: number; event: CalendarEvent }>();
  let decodedFor = "";
  let decodedKey: CryptoKey | null = null;

  const open = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(EVENTS);
        req.result.createObjectStore(BUCKETS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));

  const getMany = async <T>(store: string, keys: string[]) => {
    const objects = (await open()).transaction(store).objectStore(store);
    return Promise.all(
      keys.map((key) => request<T | undefined>(objects.get(key))),
    );
  };

  const resetDecoded = (masterKey: CryptoKey) => {
    const signature = `${Settings.defaultZone.name}|${Settings.defaultLocale}`;
    if (decodedFor === signature && decodedKey === masterKey) return;
    decoded = new Map();
    decodedFor = signature;
    decodedKey = masterKey;
  };

  const toEvents = async (records: CachedEvent[], masterKey: CryptoKey) => {
    resetDecoded(masterKey);
    const stale = records.filter((r) => decoded.get(r.id)?.ts !== r.updatedAt);
    for (const ev of await decryptEvents(stale, masterKey)) {
      const event = { ...ev.data, timestamp: ev.updatedAt };
      decoded.set(ev.id, { ts: ev.updatedAt, event });
    }
    return records.flatMap((r) => {
      const event = decoded.get(r.id)?.event;
      return event?.start.isValid && event.end.isValid ? [event] : [];
    });
  };

  const readIndex = async (ids: string[], masterKey: CryptoKey) => {
    const blobs = await getMany<ArrayBuffer>(BUCKETS, ids);
    const entries = await Promise.all(
      blobs.map((blob) => (blob ? decodeIndex(blob, masterKey) : [])),
    );
    return new Map(ids.map((id, i) => [id, entries[i]]));
  };

  return {
    readIndex,

    async records(ids: string[]) {
      const found = await getMany<CachedEvent>(EVENTS, ids);
      return found.filter((r) => r !== undefined);
    },

    async events(ids: string[], masterKey: CryptoKey) {
      const found = await getMany<CachedEvent>(EVENTS, [...new Set(ids)]);
      return toEvents(
        found.filter((r) => r !== undefined),
        masterKey,
      );
    },

    async allEvents(masterKey: CryptoKey) {
      const db = await open();
      const all = await request<CachedEvent[]>(
        db.transaction(EVENTS).objectStore(EVENTS).getAll(),
      );
      return toEvents(all, masterKey);
    },

    async apply(
      upserts: CacheUpsert[],
      deletes: string[],
      masterKey: CryptoKey,
    ) {
      const touched = [...new Set([...upserts.map((u) => u.id), ...deletes])];
      const previous = (await getMany<CachedEvent>(EVENTS, touched)).filter(
        (r) => r !== undefined,
      );

      const bucketIds = new Set([
        ...previous.flatMap((r) => r.buckets),
        ...upserts.flatMap((u) => u.buckets),
      ]);
      const index = await readIndex([...bucketIds], masterKey);
      const lists = new Map(
        [...index].map(([id, entries]) => [
          id,
          new Map(entries.map((e) => [e.id, e.ts])),
        ]),
      );

      for (const r of previous) {
        for (const b of r.buckets) lists.get(b)!.delete(r.id);
      }
      for (const u of upserts) {
        for (const b of u.buckets) lists.get(b)!.set(u.id, u.updatedAt);
      }

      const encoded = await Promise.all(
        [...lists].map(async ([id, list]) => ({
          id,
          blob: list.size
            ? await encodeIndex(
                [...list].map(([id, ts]) => ({ id, ts })),
                masterKey,
              )
            : null,
        })),
      );

      const db = await open();
      const tx = db.transaction([EVENTS, BUCKETS], "readwrite");
      const events = tx.objectStore(EVENTS);
      const buckets = tx.objectStore(BUCKETS);
      for (const id of deletes) events.delete(id);
      for (const { id, data, updatedAt, buckets: ids } of upserts) {
        events.put({ id, data, updatedAt, buckets: ids }, id);
      }
      for (const { id, blob } of encoded) {
        if (blob) buckets.put(blob, id);
        else buckets.delete(id);
      }
      await finished(tx);

      resetDecoded(masterKey);
      for (const id of deletes) decoded.delete(id);
      for (const u of upserts) {
        decoded.set(u.id, { ts: u.updatedAt, event: u.event });
      }
    },

    async clear() {
      const db = await open();
      const tx = db.transaction([EVENTS, BUCKETS], "readwrite");
      tx.objectStore(EVENTS).clear();
      tx.objectStore(BUCKETS).clear();
      await finished(tx);
      decoded = new Map();
    },
  };
};

export type EventCache = ReturnType<typeof createEventCache>;
