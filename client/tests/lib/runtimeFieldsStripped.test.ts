import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/gzip.ts", () => ({
  compress: async (input: Uint8Array) => input,
  decompress: async (input: Uint8Array) => input,
}));

import { DateTime } from "luxon";
import { decrypt, encrypt } from "../../src/lib/crypt";
import { withClient, CLIENT_ID } from "../../src/lib/clientId";
import { decryptEvents, encryptEvents } from "../../src/lib/calendar/crypt";
import { decryptItem, encryptItem } from "../../src/lib/journal/crypt";
import {
  arrayBufferToBase64,
  uint8ArrayFromBase64,
} from "../../src/lib/utils";
import type { JournalItem } from "../../src/types/Journal";
import type { CalendarEvent } from "../../src/types/calendar/Event";

const aesKey = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);

const hmacKey = () =>
  crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

const seal = async (value: unknown, key: CryptoKey) =>
  arrayBufferToBase64(
    await encrypt(new TextEncoder().encode(JSON.stringify(value)), key),
  );

const event = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "x",
  start: DateTime.fromISO("2026-03-10T10:00:00Z", { zone: "utc" }),
  end: DateTime.fromISO("2026-03-10T11:00:00Z", { zone: "utc" }),
  timestamp: 1790000000000,
} as CalendarEvent;

describe("runtime fields never cross the wire", () => {
  it("drops underscore fields when encrypting events", async () => {
    const key = await aesKey();
    const [record] = await encryptEvents(
      [{ ...event, _shared: { space: "s" }, _remote: true } as CalendarEvent],
      key,
      await hmacKey(),
    );

    const stored = new TextDecoder().decode(
      await decrypt(uint8ArrayFromBase64(record.data), key),
    );
    expect(stored).not.toContain("_shared");
    expect(stored).not.toContain("_remote");
    expect(stored).toContain('"title":"x"');
  });

  it("drops underscore fields a sender smuggled into an event", async () => {
    const key = await aesKey();
    const data = await seal(
      { ...event, _shared: { space: "forged" }, _remote: true },
      key,
    );

    const [decrypted] = await decryptEvents(
      [{ id: event.id, updatedAt: 1, data, buckets: [] }],
      key,
    );
    expect(decrypted.data).not.toHaveProperty("_shared");
    expect(decrypted.data).not.toHaveProperty("_remote");
    expect(decrypted.data.title).toBe("x");
  });

  it("drops underscore fields a sender smuggled into a note", async () => {
    const key = await aesKey();
    const note = {
      id: "0a000000-0000-4000-8000-000000000000",
      parentId: null,
      type: "note",
      name: "n",
      content: "",
      createdAt: 1,
      updatedAt: 1,
      _shared: { space: "forged" },
      _virtual: true,
    };

    const record = await encryptItem(note as JournalItem, key);
    const item = await decryptItem({ ...record, updatedAt: 5 }, key);
    expect(item).toMatchObject({ name: "n", updatedAt: 5 });
    expect(item).not.toHaveProperty("_shared");
    expect(item).not.toHaveProperty("_virtual");
  });
});

describe("journal encryption", () => {
  it("never writes the shared marks into the record", async () => {
    const key = await aesKey();
    const note = {
      id: "0a000000-0000-4000-8000-000000000000",
      name: "n",
      _shared: { space: "s" },
      _virtual: true,
    };

    const record = await encryptItem(note as unknown as JournalItem, key);
    const stored = JSON.parse(
      new TextDecoder().decode(
        await decrypt(uint8ArrayFromBase64(record.data), key),
      ),
    );
    expect(stored).toEqual({ id: note.id, name: "n" });
  });
});

describe("withClient", () => {
  it("adds this client to a path with or without a query", () => {
    expect(withClient("journal/save")).toBe(`journal/save?c=${CLIENT_ID}`);
    expect(withClient("shares/save?space=s")).toBe(
      `shares/save?space=s&c=${CLIENT_ID}`,
    );
  });
});
