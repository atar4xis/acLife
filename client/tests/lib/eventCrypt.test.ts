import { beforeAll, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
import { FakeArgonWorker } from "./fakeArgonWorker";

vi.stubGlobal("Worker", FakeArgonWorker);

const { generateMasterKeyEnvelope } = await import("../../src/lib/crypt.ts");
const { decryptEvents, encryptEvents } = await import(
  "../../src/lib/calendar/crypt.ts"
);

const event = (id: string) =>
  ({
    id,
    title: id,
    start: DateTime.fromISO("2026-01-05T10:00:00Z"),
    end: DateTime.fromISO("2026-01-05T11:00:00Z"),
    timestamp: 1000,
  }) as unknown as CalendarEvent;

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

let masterKey: CryptoKey;
let bucketKey: CryptoKey;

beforeAll(async () => {
  ({ masterKey, bucketKey } = await generateMasterKeyEnvelope("password-123!"));
}, 30000);

describe("decryptEvents", () => {
  it.each([
    ["the same time", 1000, true],
    ["a time within the drift", 1900, true],
    ["a newer time than the content has", 5000, false],
    ["an older time than the content has", -5000, false],
  ])("handles an event filed under %s", async (_name, updatedAt, kept) => {
    const [encrypted] = await encryptEvents([event(A)], masterKey, bucketKey);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await decryptEvents([{ ...encrypted, updatedAt }], masterKey);

    expect(result).toHaveLength(kept ? 1 : 0);
  });

  it("returns events filed under their own id, whatever its case", async () => {
    const [encrypted] = await encryptEvents([event(A)], masterKey, bucketKey);

    const result = await decryptEvents(
      [{ ...encrypted, id: A.toUpperCase() }],
      masterKey,
    );

    expect(result.map((ev) => ev.data.id)).toEqual([A]);
  });

  it("drops an event the server filed under another event's id", async () => {
    const [a, b] = await encryptEvents(
      [event(A), event(B)],
      masterKey,
      bucketKey,
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await decryptEvents([{ ...a, id: B }, b], masterKey);

    expect(result.map((ev) => ev.id)).toEqual([B]);
    expect(result[0].data.title).toBe(B);
  });
});
