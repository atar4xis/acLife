import type { DateTime } from "luxon";
import type { CalendarEvent } from "@/types/calendar/Event";
import { occurrences } from "./occurrences";
import { hmacSign } from "../crypt";
import { arrayBufferToBase64 } from "../utils";

export const SYNC_RANGE_WEEKS = 1; // weeks in each direction
export const RECURRING_BUCKET_LABEL = "recurring";
export const MAX_SYNC_BUCKETS_PER_REQUEST = 100;
export const MAX_SERIES_BUCKETS = 32;

export const weekLabel = (date: DateTime): string => {
  const utc = date.toUTC();
  return `${utc.weekYear}-W${String(utc.weekNumber).padStart(2, "0")}`;
};

export const computeBucketId = async (
  bucketKey: CryptoKey,
  label: string,
): Promise<string> => {
  return arrayBufferToBase64(await hmacSign(bucketKey, label));
};

export const computeBucketHash = async (
  events: { id: string; ts: number }[],
): Promise<string> => {
  const lines = events.map((ev) => `${ev.id.toLowerCase()}:${ev.ts}`).sort();
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(lines.join("\n")),
  );
  return arrayBufferToBase64(hash);
};

const weekLabels = (start: DateTime, end: DateTime) => {
  const labels: string[] = [];
  const endWeek = end.toUTC().startOf("week");
  for (let cursor = start.toUTC().startOf("week"); cursor <= endWeek;) {
    labels.push(weekLabel(cursor));
    cursor = cursor.plus({ weeks: 1 });
  }
  return labels;
};

const seriesWeekLabels = (
  event: Pick<CalendarEvent, "start" | "end" | "repeat">,
) => {
  const labels = new Set(weekLabels(event.start, event.end));
  const duration = event.end.diff(event.start);

  for (const start of occurrences(event.start, event.repeat!)) {
    if (labels.size >= MAX_SERIES_BUCKETS) return null;
    for (const label of weekLabels(start, start.plus(duration))) {
      labels.add(label);
    }
  }

  return labels.size < MAX_SERIES_BUCKETS ? labels : null;
};

export const eventBucketLabels = (
  event: Pick<CalendarEvent, "start" | "end" | "repeat">,
): string[] => {
  const { repeat } = event;
  const bounded = repeat && (repeat.until !== undefined || repeat.count);
  const series = bounded ? seriesWeekLabels(event) : null;
  if (series) return Array.from(series);

  const labels = weekLabels(event.start, event.end);
  return repeat ? [...labels, RECURRING_BUCKET_LABEL] : labels;
};

export const computeEventBuckets = async (
  event: Pick<CalendarEvent, "start" | "end" | "repeat">,
  bucketKey: CryptoKey,
): Promise<string[]> =>
  Promise.all(
    eventBucketLabels(event).map((label) => computeBucketId(bucketKey, label)),
  );

export const computeSyncRangeBuckets = async (
  currentDate: DateTime,
  bucketKey: CryptoKey,
  range: number = SYNC_RANGE_WEEKS,
): Promise<string[]> => {
  const labels = [RECURRING_BUCKET_LABEL];
  for (let i = -range; i <= range; i++) {
    labels.push(weekLabel(currentDate.plus({ weeks: i })));
  }

  return Promise.all(labels.map((label) => computeBucketId(bucketKey, label)));
};

export const computeExpandedRangeBuckets = async (
  currentDate: DateTime,
  bucketKey: CryptoKey,
  fromRange: number,
  toRange: number,
): Promise<string[]> => {
  const labels: string[] = [];
  for (let i = -toRange; i <= toRange; i++) {
    if (i >= -fromRange && i <= fromRange) continue;
    labels.push(weekLabel(currentDate.plus({ weeks: i })));
  }

  return Promise.all(labels.map((label) => computeBucketId(bucketKey, label)));
};
