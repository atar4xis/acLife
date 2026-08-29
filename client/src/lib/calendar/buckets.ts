import type { DateTime } from "luxon";
import type { CalendarEvent } from "@/types/calendar/Event";
import { hmacSign } from "../crypt";
import { arrayBufferToBase64 } from "../utils";

export const SYNC_RANGE_WEEKS = 1; // weeks in each direction
export const RECURRING_BUCKET_LABEL = "recurring";
export const MAX_SYNC_BUCKETS_PER_REQUEST = 100;

export const weekLabel = (date: DateTime): string =>
  `${date.weekYear}-W${String(date.weekNumber).padStart(2, "0")}`;

export const computeBucketId = async (
  bucketKey: CryptoKey,
  label: string,
): Promise<string> => {
  return arrayBufferToBase64(await hmacSign(bucketKey, label));
};

export const computeEventBuckets = async (
  event: Pick<CalendarEvent, "start" | "end" | "repeat">,
  bucketKey: CryptoKey,
): Promise<string[]> => {
  const labels = new Set<string>();

  let cursor = event.start.startOf("week");
  const endWeek = event.end.startOf("week");
  while (cursor <= endWeek) {
    labels.add(weekLabel(cursor));
    cursor = cursor.plus({ weeks: 1 });
  }

  if (event.repeat) labels.add(RECURRING_BUCKET_LABEL);

  return Promise.all(
    Array.from(labels).map((label) => computeBucketId(bucketKey, label)),
  );
};

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
