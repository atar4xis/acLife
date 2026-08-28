import type { DateTime } from "luxon";

export type RepeatIntervalUnit = "day" | "week" | "month" | "year";

export type RepeatInterval = {
  interval: number;
  unit: RepeatIntervalUnit;
  except?: number[]; // don't repeat on these weekdays
  skip?: string[]; // skip these dates
  until?: number; // millis
};

export type CalendarEvent = {
  id: string;
  start: DateTime;
  end: DateTime;
  title: string;
  description?: string;
  color?: string;
  repeat?: RepeatInterval;
  timestamp: number;
  _parent?: string; // uuid of parent event
  _continued?: boolean; // events spanning multiple days
  _instanceId?: string; // internal instance id
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
