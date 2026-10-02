import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DateTime } from "luxon";
import type { ReactNode } from "react";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
import type { User } from "../../src/types/User.ts";

type Row = { id: string; data: string; updatedAt: number };

const server = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  post: null as unknown as (
    endpoint: string,
    body: unknown,
  ) => Promise<unknown>,
}));

vi.mock("../../src/lib/gzip.ts", () => ({
  compress: async (input: Uint8Array) => input,
  decompress: async (input: Uint8Array) => input,
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({ post: (e: string, b: unknown) => server.post(e, b) }),
}));

vi.mock("../../src/context/StorageContext.tsx", async () => {
  const { createStorageContext } = await vi.importActual<
    typeof import("../../src/context/StorageContext.tsx")
  >("../../src/context/StorageContext.tsx");
  const { memoryAdapter } = await import("../../src/lib/adapter/memory.ts");
  const defaults = { cachedEvents: null } as never;
  return createStorageContext(memoryAdapter(defaults), defaults);
});

const { useCalendarEvents } =
  await import("../../src/hooks/calendar/useCalendarEvents.ts");
const { StorageProvider } =
  await import("../../src/context/StorageContext.tsx");
const { getEventMap } = await import("../../src/lib/calendar/event.ts");

const toUuid = (b64: string) => {
  const hex = Array.from(atob(b64), (c) =>
    c.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
  return [8, 4, 4, 4, 12]
    .map((n, i) => hex.slice([0, 8, 12, 16, 20][i], [0, 8, 12, 16, 20][i] + n))
    .join("-");
};

server.post = async (endpoint, body) => {
  if (endpoint.startsWith("calendar/events/save")) {
    for (const change of body as { event: Row }[]) {
      server.rows.set(change.event.id, change.event);
    }
    return { success: true };
  }

  if ("hashes" in (body as object)) {
    const { hashes } = body as { hashes: Record<string, string> };
    return { success: true, data: { mismatched: Object.keys(hashes) } };
  }

  const known = new Set(
    (body as { events: { id: string }[] }).events.map((e) => toUuid(e.id)),
  );
  const added = [...server.rows.values()].filter((r) => !known.has(r.id));
  return {
    success: true,
    data: { added, updated: [], deleted: [], needsBucketBackfill: [] },
  };
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <StorageProvider>{children}</StorageProvider>
);

describe("useCalendarEvents cache", () => {
  it("keeps derived keys out of cached events so repeats still expand", async () => {
    const user = { type: "online" } as User;
    const masterKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const bucketKey = await crypto.subtle.generateKey(
      { name: "HMAC", hash: "SHA-256" },
      true,
      ["sign"],
    );
    const start = DateTime.fromISO("2026-03-18T09:00");
    const event = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Daily",
      timestamp: 1,
      start,
      end: start.plus({ days: 2 }),
      repeat: { interval: 1, unit: "day" },
      _continued: true,
    } as CalendarEvent;

    const { result } = renderHook(
      () => useCalendarEvents(user, masterKey, bucketKey),
      { wrapper },
    );

    await act(async () => {
      await result.current.saveEvents([{ type: "updated", event }], () => {});
    });
    const synced = await result.current.syncEvents(
      user,
      masterKey,
      bucketKey,
      start,
    );

    expect(Object.keys(synced[0]).filter((k) => k.startsWith("_"))).toEqual([]);

    const days = Array.from({ length: 7 }, (_, i) =>
      DateTime.fromISO("2026-03-16").plus({ days: i }),
    );
    const instances = [...getEventMap(synced, days, [], []).values()]
      .flat()
      .filter((e) => e._instanceId);
    expect(instances.length).toBeGreaterThan(0);
  });
});
