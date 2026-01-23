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
  parent?: string; // uuid of parent event
  timestamp: number;
  continued?: boolean; // events spanning multiple days
};

export type EncryptedEvent = {
  id: string;
  data: string;
  updatedAt: number;
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
  type: "move" | "resize_start" | "resize_end";
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
} | null;

export type CachedEvent = {
  id: string;
  updatedAt: number;
};

export type EventSyncResponse = {
  updated: EncryptedEvent[];
  deleted: string[];
  added: EncryptedEvent[];
};

export type EventChange = {
  type: "added" | "updated" | "deleted";
  event?: CalendarEvent; // for added/updated
  id?: string; // for deleted
};
