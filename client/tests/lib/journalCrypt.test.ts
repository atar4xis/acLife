import { describe, expect, it, vi } from "vitest";
vi.mock("../../src/lib/gzip.ts", () => ({
  compress: async (input: Uint8Array) => input,
  decompress: async (input: Uint8Array) => input,
}));

import { encryptJson } from "../../src/lib/crypt.ts";
import {
  decryptItem,
  decryptJournal,
  encryptItem,
} from "../../src/lib/journal/crypt.ts";
import type { JournalItem } from "../../src/types/Journal.ts";

const generate = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);

describe("journal crypt", () => {
  it("round-trips through encryption and rejects the wrong key", async () => {
    const key = await generate();
    const data = { items: [], sort: "created-asc" as const };
    const encrypted = await encryptJson(data, key);

    expect(await decryptJournal(encrypted, key)).toEqual(data);
    await expect(decryptJournal(encrypted, await generate())).rejects.toThrow();
  });
});

describe("item crypt", () => {
  const note: JournalItem = {
    id: "0a000001-0000-4000-8000-000000000001",
    type: "note",
    parentId: null,
    name: "Diary name",
    content: "Secret text",
    createdAt: 5,
    updatedAt: 1790000000001,
  };

  it("round trips an item under its id and modified time", async () => {
    const key = await generate();
    const event = await encryptItem(note, key);

    expect(event).toMatchObject({ id: note.id, updatedAt: note.updatedAt });
    expect(await decryptItem(event, key)).toEqual(note);
  });

  it("hides the name and content in the ciphertext", async () => {
    const event = await encryptItem(note, await generate());
    const text = atob(event.data);

    expect(text).not.toContain("Diary name");
    expect(text).not.toContain("Secret text");
  });

  it("takes the modified time from the server row", async () => {
    const key = await generate();
    const event = await encryptItem(note, key);

    expect(
      (await decryptItem({ ...event, updatedAt: 42 }, key))?.updatedAt,
    ).toBe(42);
  });

  it("drops an item stored under a different id and ignores the id case", async () => {
    const key = await generate();
    const event = await encryptItem(note, key);

    expect(
      await decryptItem({ ...event, id: "0a000002-0000-4000-8000-000000000002" }, key),
    ).toBeNull();
    expect(
      await decryptItem({ ...event, id: event.id.toUpperCase() }, key),
    ).toEqual(note);
  });

  it("returns null for ciphertext of another key", async () => {
    const event = await encryptItem(note, await generate());

    expect(await decryptItem(event, await generate())).toBeNull();
  });
});
