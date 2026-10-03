import type { DateTime } from "luxon";

export type RepeatIntervalUnit = "day" | "week" | "month" | "year";

export type OccurrenceOverride = {
  title?: string;
  description?: string | null; // null clears the series value
  color?: string | null;
  startShift?: number; // millis from the nominal start
  endShift?: number; // millis from the nominal end
};

export type RepeatInterval = {
  interval: number;
  unit: RepeatIntervalUnit;
  except?: number[]; // don't repeat on these weekdays
  monthly?: "date" | "nth" | "last" | "days";
  days?: number[]; // weekdays (1-7) for weeks, dates (1-31) for monthly "days"
  yearDays?: string[]; // "MM-DD"
  skip?: string[]; // skip these dates
  until?: number; // millis
  count?: number; // total occurrences, including the first
  overrides?: Record<string, OccurrenceOverride>; // edited attached instances, by UTC date
};

export type CalendarEvent = {
  id: string;
  start: DateTime;
  end: DateTime;
  title: string;
  description?: string;
  color?: string;
  repeat?: RepeatInterval;
  isTask?: boolean;
  completed?: boolean; // completion state for non-recurring tasks
  completedInstances?: string[]; // ISO dates of completed occurrences, for recurring tasks
  deadline?: DateTime;
  timestamp: number;
  _parent?: string; // uuid of parent event
  _continued?: boolean; // events spanning multiple days
  _instanceId?: string; // internal instance id
  _overrideKey?: string; // UTC date of the occurrence, the key of its override
  _resettable?: boolean; // instance with an override that can be removed
};

export type RejectedEvent = {
  id: string;
  title: string;
  wasAdded: boolean;
  previous?: CalendarEvent; // last saved version, to restore
};

export type EncryptedEvent = {
  id: string;
  data: string;
  updatedAt: number;
  buckets?: string[]; // base64-encoded bucket ids, only client -> server
};

export type DecryptedEvent = {
  id: string;
  data: CalendarEvent;
  updatedAt: number;
};

export type EventStyle = {
  top: number;
  height: number;
  width: number;
  left: number;
};

export type PositionedEvent = CalendarEvent & {
  top: number;
  height: number;
  col: number;
  maxCols: number;
};

export type RawCalendarEvent = Omit<CalendarEvent, "start" | "end"> & {
  start: string;
  end: string;
};

export type EventDragRef = {
  pointerId: number;
  type: "move" | "resize_start" | "resize_end" | "new";
  startY: number;
  x: number;
  y: number;
  event: CalendarEvent;
  originalDay: number;
  originalStart: DateTime;
  originalEnd: DateTime;
  label: string;
  dayRects: { day: number; rect: DOMRect }[];
  moved: boolean;
  dayDelta?: number;
  deltaMinutes?: number;
  resize?: {
    start: number;
    end: number;
    touch?: { id: number; side: "start" | "end"; y: number; base: number };
  };
  selection?: {
    event: CalendarEvent;
    originalStart: DateTime;
    originalEnd: DateTime;
  }[];
} | null;

export type CachedEvent = {
  id: string;
  updatedAt: number;
};

// when buckets is omitted, the server performs a full sync
export type EventSyncRequest = {
  events: { id: string; ts: number }[];
  buckets?: string[];
};

export type EventHashRequest = {
  hashes: Record<string, string>; // bucket id -> hash of cached events in it
};

export type EventHashResponse = {
  mismatched: string[];
};

export type EventSyncResponse = {
  updated: EncryptedEvent[];
  deleted: string[];
  added: EncryptedEvent[];
  needsBucketBackfill: string[]; // ids of returned events with no bucket rows yet
};

export type EventChange = {
  type: "added" | "updated" | "deleted";
  event?: CalendarEvent; // for added/updated
  id?: string; // for deleted
};

export type WithoutPrivateKeys<T> = {
  [K in keyof T as K extends `_${string}` ? never : K]: T[K];
};
