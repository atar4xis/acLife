import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import type { CalendarEvent } from "@/types/calendar/Event";
import type { User } from "@/types/User";
import {
  SYNC_RANGE_WEEKS,
  MAX_SYNC_BUCKETS_PER_REQUEST,
  computeExpandedRangeBuckets,
} from "@/lib/calendar/buckets";
import { normalize, sleep, tokenize } from "@/lib/utils";

export const SEARCH_DEBOUNCE_MS = 500;
export const MAX_SEARCH_RESULTS = 80;
export const MAX_EXPAND_STEP_WEEKS = Math.floor(
  MAX_SYNC_BUCKETS_PER_REQUEST / 2,
);
export const REQUEST_DELAY_MS = 1000;
export const SEARCH_RADIUS_CHECKPOINTS = [53, 106, 159];

const matchesQuery = (event: CalendarEvent, tokens: string[]) => {
  const haystack = normalize(`${event.title} ${event.description ?? ""}`);
  return tokens.every((token) => haystack.includes(token));
};

const nextCheckpoint = (currentRange: number): number | null =>
  SEARCH_RADIUS_CHECKPOINTS.find((c) => c > currentRange) ?? null;

export const useCalendarSearch = (
  events: CalendarEvent[],
  user: User | null,
  masterKey: CryptoKey | null,
  bucketKey: CryptoKey | null,
  currentDate: DateTime,
  syncBuckets: (
    buckets: string[],
    masterKey: CryptoKey,
    bucketKey: CryptoKey,
  ) => Promise<CalendarEvent[]>,
  onExpandedEvents: (events: CalendarEvent[]) => void,
) => {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isExpanding, setIsExpanding] = useState(false);

  const syncedRangeRef = useRef(SYNC_RANGE_WEEKS);
  const searchGenRef = useRef(0);

  useEffect(() => {
    const timeout = setTimeout(
      () => setDebouncedQuery(query),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timeout);
  }, [query]);

  const tokens = useMemo(() => tokenize(debouncedQuery), [debouncedQuery]);

  const results = useMemo(() => {
    if (tokens.length === 0) return [];
    const now = DateTime.now().toMillis();
    return events
      .filter((ev) => matchesQuery(ev, tokens))
      .sort(
        (a, b) =>
          Math.abs(a.start.toMillis() - now) -
          Math.abs(b.start.toMillis() - now),
      )
      .slice(0, MAX_SEARCH_RESULTS);
  }, [events, tokens]);

  const canExpandMore =
    tokens.length > 0 &&
    user &&
    user.type === "online" &&
    masterKey &&
    bucketKey &&
    nextCheckpoint(syncedRangeRef.current) !== null;

  const runStage = useCallback(
    async (
      targetRange: number,
      tokensSnapshot: string[],
      gen: number,
    ): Promise<boolean> => {
      if (!masterKey || !bucketKey) return false;

      let matched = false;
      while (syncedRangeRef.current < targetRange) {
        if (gen !== searchGenRef.current) return matched;

        const nextRange = Math.min(
          syncedRangeRef.current + MAX_EXPAND_STEP_WEEKS,
          targetRange,
        );

        const buckets = await computeExpandedRangeBuckets(
          currentDate,
          bucketKey,
          syncedRangeRef.current,
          nextRange,
        );
        const merged = await syncBuckets(buckets, masterKey, bucketKey);
        if (gen !== searchGenRef.current) return matched;

        syncedRangeRef.current = nextRange;
        onExpandedEvents(merged);

        if (merged.some((ev) => matchesQuery(ev, tokensSnapshot))) {
          matched = true;
          break;
        }

        if (syncedRangeRef.current < targetRange) await sleep(REQUEST_DELAY_MS);
      }

      return matched;
    },
    [currentDate, masterKey, bucketKey, syncBuckets, onExpandedEvents],
  );

  const runStageRef = useRef(runStage);
  runStageRef.current = runStage;

  useEffect(() => {
    const gen = ++searchGenRef.current;
    syncedRangeRef.current = SYNC_RANGE_WEEKS;

    if (tokens.length === 0) return;
    if (!user || user.type !== "online" || !masterKey || !bucketKey) return;

    const target = nextCheckpoint(syncedRangeRef.current);
    if (target === null) return;

    const run = async () => {
      setIsExpanding(true);
      try {
        await runStageRef.current(target, tokens, gen);
      } finally {
        if (gen === searchGenRef.current) setIsExpanding(false);
      }
    };

    run();
  }, [tokens, user, masterKey, bucketKey]);

  const expandSearchRadius = useCallback(() => {
    if (isExpanding || tokens.length === 0) return;
    if (!user || user.type !== "online" || !masterKey || !bucketKey) return;

    const target = nextCheckpoint(syncedRangeRef.current);
    if (target === null) return;

    const gen = searchGenRef.current;

    const run = async () => {
      setIsExpanding(true);
      try {
        await runStageRef.current(target, tokens, gen);
      } finally {
        if (gen === searchGenRef.current) setIsExpanding(false);
      }
    };

    run();
  }, [isExpanding, tokens, user, masterKey, bucketKey]);

  return {
    query,
    setQuery,
    results,
    isExpanding,
    canExpandMore,
    expandSearchRadius,
  };
};
