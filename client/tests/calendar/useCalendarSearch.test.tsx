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
      | ((props: {
          syncBuckets: ReturnType<typeof makeSyncBuckets>;
        }) => void)
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

    expect(calls).toHaveLength(firstCheckpointChunks.length + secondCheckpointChunks.length);
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
});
