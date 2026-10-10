import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DateTime } from "luxon";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { CalendarEvent } from "../../src/types/calendar/Event.ts";
import type { User } from "../../src/types/User.ts";

const server = vi.hoisted(() => ({
  posted: [] as { record?: { id: string }; id?: string; type: string }[][],
  post: null as unknown as (e: string, b: unknown) => Promise<unknown>,
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

const wrapper = ({ children }: { children: ReactNode }) => (
  <StorageProvider>{children}</StorageProvider>
);

const start = DateTime.fromISO("2026-03-18T09:00");
const make = (id: string, extra: Partial<CalendarEvent> = {}) =>
  ({
    id,
    title: "Standup",
    timestamp: 1,
    start,
    end: start.plus({ hours: 1 }),
    ...extra,
  }) as CalendarEvent;

let A = "";
let B = "";
let seq = 0;
const huge = "x".repeat(12000);

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

const setup = async () => {
  const user = { type: "online" } as User;
  return renderHook(() => useCalendarEvents(user, masterKey, bucketKey), {
    wrapper,
  });
};

describe("saving an oversized event", () => {
  beforeEach(() => {
    seq++;
    A = `1111111${seq}-1111-4111-8111-111111111111`;
    B = `2222222${seq}-2222-4222-8222-222222222222`;
    server.posted = [];
    vi.mocked(toast.error).mockClear();
    server.post = async (_endpoint, body) => {
      server.posted.push(body as never);
      return { success: true };
    };
  });

  it("keeps it out of the request, tells the user, and hands back the last saved version", async () => {
    const { result } = await setup();
    const saved = make(A);
    await act(async () => {
      await result.current.saveEvents([{ type: "updated", event: saved }], () => {});
    });
    const { record } = server.posted[0][0] as unknown as {
      record: { id: string; data: string; updatedAt: number };
    };
    await act(async () => {
      await result.current.applyChanges(
        [{ type: "updated", id: record.id, data: record.data, updatedAt: record.updatedAt }],
        masterKey,
        bucketKey,
      );
    });
    server.posted = [];

    const onRejected = vi.fn();
    const cb = vi.fn();
    await act(async () => {
      await result.current.saveEvents(
        [{ type: "updated", event: make(A, { description: huge }) }],
        cb,
        onRejected,
      );
    });

    expect(server.posted).toEqual([]);
    expect(onRejected).toHaveBeenCalledTimes(1);
    const [rejected] = onRejected.mock.calls[0][0];
    expect(rejected).toMatchObject({ id: A, title: "Standup", wasAdded: false });
    expect(rejected.previous.description).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("too large"));
    expect(cb).toHaveBeenCalled();
  });

  it("still saves the other events in the same batch", async () => {
    const { result } = await setup();
    const onRejected = vi.fn();
    const cb = vi.fn();
    await act(async () => {
      await result.current.saveEvents(
        [
          { type: "added", event: make(A, { description: huge }) },
          { type: "added", event: make(B) },
        ],
        cb,
        onRejected,
      );
    });

    expect(server.posted).toHaveLength(1);
    expect(server.posted[0].map((c) => c.record?.id)).toHaveLength(1);
    expect(onRejected.mock.calls[0][0][0]).toMatchObject({
      id: A,
      wasAdded: true,
      previous: undefined,
    });
    expect(cb).toHaveBeenCalled();
  });

  it("counts the events when several are too large", async () => {
    const { result } = await setup();
    await act(async () => {
      await result.current.saveEvents(
        [
          { type: "added", event: make(A, { description: huge }) },
          { type: "added", event: make(B, { description: huge }) },
        ],
        () => {},
        vi.fn(),
      );
    });

    expect(toast.error).toHaveBeenCalledWith(
      "2 events are too large to save, so their changes were undone.",
    );
  });

  it("names a series that grew too large from its edited instances", async () => {
    const { result } = await setup();
    const overrides = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [
        DateTime.fromISO("2026-04-01").plus({ days: i }).toISODate()!,
        { title: `Standup number ${i}`, startShift: 3600000, endShift: 3600000 },
      ]),
    );
    await act(async () => {
      await result.current.saveEvents(
        [
          {
            type: "updated",
            event: make(A, { repeat: { interval: 1, unit: "day", overrides } }),
          },
        ],
        () => {},
        vi.fn(),
      );
    });

    expect(server.posted).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("is too large to save"),
    );
  });

  it("does not undo an event that was deleted after the oversized edit", async () => {
    const { result } = await setup();
    const onRejected = vi.fn();
    await act(async () => {
      await result.current.saveEvents(
        [
          { type: "updated", event: make(A, { description: huge }) },
          { type: "deleted", id: A },
        ],
        () => {},
        onRejected,
      );
    });

    expect(onRejected.mock.calls[0][0]).toEqual([]);
    expect(server.posted).toHaveLength(1);
    expect(server.posted[0]).toEqual([{ type: "deleted", id: A }]);
  });

  const withJsonLength = (length: number) => {
    const empty = JSON.stringify(make(A, { description: "" })).length;
    return make(A, { description: "x".repeat(length - empty) });
  };

  it("sends an event of exactly the limit", async () => {
    const { result } = await setup();
    const event = withJsonLength(10000 - 28);
    const onRejected = vi.fn();
    await act(async () => {
      await result.current.saveEvents(
        [{ type: "added", event }],
        () => {},
        onRejected,
      );
    });

    expect(onRejected).not.toHaveBeenCalled();
    expect(server.posted).toHaveLength(1);
  });

  it("refuses an event one byte over the limit", async () => {
    const { result } = await setup();
    const event = withJsonLength(10000 - 28 + 1);
    const onRejected = vi.fn();
    await act(async () => {
      await result.current.saveEvents(
        [{ type: "added", event }],
        () => {},
        onRejected,
      );
    });

    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(server.posted).toEqual([]);
  });

  it("sends events under the limit untouched", async () => {
    const { result } = await setup();
    const onRejected = vi.fn();
    await act(async () => {
      await result.current.saveEvents(
        [{ type: "added", event: make(A) }],
        () => {},
        onRejected,
      );
    });

    expect(onRejected).not.toHaveBeenCalled();
    expect(server.posted).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
