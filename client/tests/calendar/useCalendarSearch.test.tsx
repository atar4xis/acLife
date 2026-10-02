import { act, renderHook } from "@testing-library/react";
import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useCalendarSearch,
  SEARCH_DEBOUNCE_MS,
  REQUEST_DELAY_MS,
  MAX_EXPAND_STEP_WEEKS,
  SEARCH_RADIUS_CHECKPOINTS,
} from "@/hooks/calendar/useCalendarSearch";
import { SYNC_RANGE_WEEKS } from "@/lib/calendar/buckets";
import type { CalendarEvent } from "@/types/calendar/Event";
import type { User } from "@/types/User";

vi.mock("@/lib/calendar/buckets", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/calendar/buckets")>();
  return {
    ...actual,
    computeExpandedRangeBuckets: vi.fn(
      async (
        _currentDate: DateTime,
        _bucketKey: CryptoKey,
        fromRange: number,
        toRange: number,
      ) => {
        const delta = 2 * (toRange - fromRange);
        return Array.from(
          { length: delta },
          (_, i) => `bucket-${fromRange}-${toRange}-${i}`,
        );
      },
    ),
  };
});

const masterKey = {} as CryptoKey;
const bucketKey = {} as CryptoKey;
const onlineUser = { type: "online" } as User;

const dentistEvent: CalendarEvent = {
  id: "dentist-event",
  title: "Dentist appointment",
  start: DateTime.now(),
  end: DateTime.now().plus({ hours: 1 }),
  timestamp: DateTime.now().toMillis(),
};

const chunkSizes = (fromRange: number, toRange: number): number[] => {
  const sizes: number[] = [];
  let range = fromRange;
  while (range < toRange) {
    const next = Math.min(range + MAX_EXPAND_STEP_WEEKS, toRange);
    sizes.push(2 * (next - range));
    range = next;
  }
  return sizes;
};

const firstCheckpointChunks = chunkSizes(
  SYNC_RANGE_WEEKS,
  SEARCH_RADIUS_CHECKPOINTS[0],
);
const secondCheckpointChunks = chunkSizes(
  SEARCH_RADIUS_CHECKPOINTS[0],
  SEARCH_RADIUS_CHECKPOINTS[1],
);

describe("useCalendarSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("paces requests and stops at the first checkpoint even when syncBuckets churns identity every call", async () => {
    const calls: string[][] = [];

    const makeSyncBuckets = () =>
      vi.fn(async (buckets: string[]): Promise<CalendarEvent[]> => {
        calls.push(buckets);
        return [];
      });

    let rerenderFn:
      | ((props: { syncBuckets: ReturnType<typeof makeSyncBuckets> }) => void)
      | null = null;

    const onExpandedEvents = () => {
      act(() => {
        rerenderFn?.({ syncBuckets: makeSyncBuckets() });
      });
    };

    const { result, rerender } = renderHook(
      (props: { syncBuckets: ReturnType<typeof makeSyncBuckets> }) =>
        useCalendarSearch(
          [],
          onlineUser,
          masterKey,
          bucketKey,
          DateTime.now(),
          props.syncBuckets,
          onExpandedEvents,
        ),
      { initialProps: { syncBuckets: makeSyncBuckets() } },
    );
    rerenderFn = rerender;

    act(() => {
      result.current.setQuery("dentist");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(firstCheckpointChunks[0]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_DELAY_MS - 1);
    });
    expect(calls).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toHaveLength(firstCheckpointChunks[1]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_DELAY_MS * 3);
    });

    expect(calls).toHaveLength(2);
    expect(result.current.canExpandMore).toBe(true);
    expect(result.current.isExpanding).toBe(false);
  });

  it("only expands to the next checkpoint when expandSearchRadius is called", async () => {
    const calls: string[][] = [];

    const syncBuckets = vi.fn(
      async (buckets: string[]): Promise<CalendarEvent[]> => {
        calls.push(buckets);
        return [];
      },
    );

    const { result } = renderHook(() =>
      useCalendarSearch(
        [],
        onlineUser,
        masterKey,
        bucketKey,
        DateTime.now(),
        syncBuckets,
        () => {},
      ),
    );

    act(() => {
      result.current.setQuery("dentist");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_DELAY_MS);
    });
    expect(calls).toHaveLength(firstCheckpointChunks.length);
    expect(result.current.canExpandMore).toBe(true);

    act(() => {
      result.current.expandSearchRadius();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toHaveLength(firstCheckpointChunks.length + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_DELAY_MS);
    });

    expect(calls).toHaveLength(
      firstCheckpointChunks.length + secondCheckpointChunks.length,
    );
    expect(result.current.canExpandMore).toBe(true);
  });

  it("allows expanding the search radius even when local results already match", async () => {
    const syncBuckets = vi.fn(async (): Promise<CalendarEvent[]> => []);

    const { result } = renderHook(() =>
      useCalendarSearch(
        [dentistEvent],
        onlineUser,
        masterKey,
        bucketKey,
        DateTime.now(),
        syncBuckets,
        () => {},
      ),
    );

    act(() => {
      result.current.setQuery("dentist");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });

    expect(result.current.results).toHaveLength(1);
    expect(result.current.canExpandMore).toBe(true);
  });

  it("resyncs the base radius from scratch on every new search instead of trusting a stale local match", async () => {
    const calls: string[][] = [];
    const syncBuckets = vi.fn(
      async (buckets: string[]): Promise<CalendarEvent[]> => {
        calls.push(buckets);
        return [];
      },
    );

    const { result } = renderHook(() =>
      useCalendarSearch(
        [dentistEvent],
        onlineUser,
        masterKey,
        bucketKey,
        DateTime.now(),
        syncBuckets,
        () => {},
      ),
    );

    act(() => {
      result.current.setQuery("dentist");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(firstCheckpointChunks[0]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_DELAY_MS);
    });

    expect(calls).toHaveLength(firstCheckpointChunks.length);
    expect(calls[1]).toHaveLength(firstCheckpointChunks[1]);

    act(() => {
      result.current.setQuery("dentist again");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(calls).toHaveLength(firstCheckpointChunks.length + 1);
    expect(calls[firstCheckpointChunks.length]).toHaveLength(
      firstCheckpointChunks[0],
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REQUEST_DELAY_MS);
    });

    expect(calls).toHaveLength(firstCheckpointChunks.length * 2);
    expect(calls[firstCheckpointChunks.length + 1]).toHaveLength(
      firstCheckpointChunks[1],
    );
  });

  describe("repeating events", () => {
    const standup = (repeat: CalendarEvent["repeat"]): CalendarEvent => ({
      id: "standup",
      title: "Standup",
      start: DateTime.now().minus({ days: 100 }).startOf("day"),
      end: DateTime.now()
        .minus({ days: 100 })
        .startOf("day")
        .plus({ hours: 1 }),
      timestamp: 0,
      repeat,
    });

    const search = async (events: CalendarEvent[], query = "standup") => {
      const { result } = renderHook(() =>
        useCalendarSearch(
          events,
          null,
          null,
          null,
          DateTime.now(),
          vi.fn(),
          vi.fn(),
        ),
      );
      act(() => {
        result.current.setQuery(query);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
      });
      return result.current.results;
    };

    it("returns occurrences around now instead of only the first start", async () => {
      const results = await search([standup({ interval: 1, unit: "day" })]);
      const now = DateTime.now().toMillis();
      expect(results).toHaveLength(6);
      expect(results.filter((e) => e.start.toMillis() > now)).toHaveLength(3);
      expect(new Set(results.map((e) => e._instanceId)).size).toBe(6);
      expect(results.every((e) => e._parent === "standup")).toBe(true);
    });

    it("honours except, skip and until", async () => {
      const today = DateTime.now().startOf("day");
      const results = await search([
        standup({
          interval: 1,
          unit: "day",
          except: [today.plus({ days: 1 }).weekday],
          skip: [today.plus({ days: 2 }).toUTC().toISODate()!],
          until: today.plus({ days: 4 }).toMillis(),
        }),
      ]);
      const upcoming = results
        .filter((e) => e.start.toMillis() >= Date.now())
        .map((e) => e.start.toISODate());
      expect(upcoming).not.toContain(today.plus({ days: 1 }).toISODate());
      expect(upcoming).not.toContain(today.plus({ days: 2 }).toISODate());
      expect(
        upcoming.every((d) => d! < today.plus({ days: 4 }).toISODate()!),
      ).toBe(true);
    });

    const today = () => DateTime.now().startOf("day");

    it("lists an override left before the series start", async () => {
      const yesterday = today().minus({ days: 1 }).toISODate()!;
      const results = await search([
        {
          ...standup({
            interval: 1,
            unit: "day",
            overrides: { [yesterday]: { title: "Standup (first)" } },
          }),
          start: today(),
          end: today().plus({ hours: 1 }),
        },
      ]);

      expect(results.map((e) => e._instanceId)).toContain(
        `standup_${yesterday}`,
      );
    });

    it("finds an instance by its own title", async () => {
      const far = today().plus({ days: 20 }).toISODate()!;
      const results = await search(
        [
          standup({
            interval: 1,
            unit: "day",
            overrides: { [far]: { title: "Retro" } },
          }),
        ],
        "retro",
      );

      expect(results.map((e) => e._instanceId)).toEqual([`standup_${far}`]);
    });

    it("caps instances found by their own title per side of now", async () => {
      const overrides = Object.fromEntries(
        [10, 11, 12, 13, 14].map((n) => [
          today().plus({ days: n }).toISODate()!,
          { title: "Retro" },
        ]),
      );
      const results = await search(
        [standup({ interval: 1, unit: "day", overrides })],
        "retro",
      );

      expect(results).toHaveLength(3);
    });

    it("leaves out instances renamed away from the query", async () => {
      const soon = today().plus({ days: 1 }).toISODate()!;
      const results = await search([
        standup({
          interval: 1,
          unit: "day",
          overrides: { [soon]: { title: "Retro" } },
        }),
      ]);

      expect(results.map((e) => e._instanceId)).not.toContain(
        `standup_${soon}`,
      );
    });

    it("fills every slot after dropping renamed instances", async () => {
      const overrides = Object.fromEntries(
        [1, 2, 3].map((n) => [
          today().plus({ days: n }).toISODate()!,
          { title: "Retro" },
        ]),
      );
      const results = await search([
        standup({ interval: 1, unit: "day", overrides }),
      ]);

      expect(results.filter((e) => e.start >= DateTime.now())).toHaveLength(3);
    });

    it("keeps non-repeating events as a single result", async () => {
      const results = await search([
        { ...standup(undefined), repeat: undefined },
      ]);
      expect(results).toHaveLength(1);
    });
  });
});
