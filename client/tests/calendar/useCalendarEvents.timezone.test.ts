import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { DateTime } from "luxon";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
import type { User } from "../../src/types/User.ts";

const apiMock = vi.hoisted(() => ({
  post: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({ post: apiMock.post }),
}));

// jsdom's Blob has no .stream(), which the real gzip helpers need, so pass bytes through unchanged
vi.mock("../../src/lib/gzip.ts", () => ({
  compress: async (input: Uint8Array) => input,
  decompress: async (input: Uint8Array) => input,
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => storageMock,
}));

const { useCalendarEvents } = await import(
  "../../src/hooks/calendar/useCalendarEvents.ts"
);
const { encryptOfflineEvents } = await import(
  "../../src/lib/calendar/crypt.ts"
);

const generateMasterKey = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);

const buildEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "good-event",
  title: "Standup",
  start: DateTime.fromISO("2026-03-18T09:00:00", { zone: "UTC" }),
  end: DateTime.fromISO("2026-03-18T09:30:00", { zone: "UTC" }),
  timestamp: Date.now(),
  ...overrides,
});

describe("useCalendarEvents cache corruption recovery", () => {
  it("drops cached events with an invalid start/end date instead of returning them broken", async () => {
    const masterKey = await generateMasterKey();

    const goodEvent = buildEvent();
    // an invalid DateTime serializes to `null`, as Settings.defaultZone="Factory" would leave behind
    const corruptedEvent = {
      ...buildEvent({ id: "corrupted-repeat", title: "Daily standup" }),
      start: null,
      end: null,
    } as unknown as CalendarEvent;

    storageMock.get.mockReturnValue(
      await encryptOfflineEvents([goodEvent, corruptedEvent], masterKey),
    );
    apiMock.post.mockResolvedValue({ success: false, message: "offline" });

    const user = { type: "online" } as User;
    const { result } = renderHook(() =>
      useCalendarEvents(user, masterKey, {} as CryptoKey),
    );

    const events = await result.current.loadEvents(
      user,
      masterKey,
      {} as CryptoKey,
      DateTime.now(),
    );

    expect(events.map((e) => e.id)).toEqual(["good-event"]);
  });

  it("keeps valid cached events fully intact", async () => {
    const masterKey = await generateMasterKey();
    const goodEvent = buildEvent();

    storageMock.get.mockReturnValue(
      await encryptOfflineEvents([goodEvent], masterKey),
    );
    apiMock.post.mockResolvedValue({ success: false, message: "offline" });

    const user = { type: "online" } as User;
    const { result } = renderHook(() =>
      useCalendarEvents(user, masterKey, {} as CryptoKey),
    );

    const events = await result.current.loadEvents(
      user,
      masterKey,
      {} as CryptoKey,
      DateTime.now(),
    );

    expect(events).toHaveLength(1);
    expect(events[0].start.toMillis()).toBe(goodEvent.start.toMillis());
    expect(events[0].end.toMillis()).toBe(goodEvent.end.toMillis());
  });
});
