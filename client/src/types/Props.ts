import type { ViewMode } from "@/types/calendar/ViewMode";
import type {
  CalendarEvent,
  EventChange,
  RejectedEvent,
} from "@/types/calendar/Event";
import type { ReactNode, PointerEvent } from "react";
import type { User } from "./User";
import type { DateTime } from "luxon";
import type { GridFocusStore } from "@/lib/calendar/gridFocus";
import type { SelectionStore } from "@/lib/calendar/selection";

export interface WithChildren {
  children?: ReactNode;
}

export interface CalendarProps {
  events: CalendarEvent[];
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  saveEvents: (
    changes: EventChange[] | CalendarEvent[],
    cb: () => void,
    onRejected?: (rejected: RejectedEvent[]) => void,
  ) => void;
  syncEvents: (
    user: User,
    masterKey: CryptoKey,
    bucketKey: CryptoKey,
    currentDate: DateTime,
  ) => Promise<CalendarEvent[]>;
  syncBuckets: (
    buckets: string[],
    masterKey: CryptoKey,
    bucketKey: CryptoKey,
  ) => Promise<CalendarEvent[]>;
  saveDebounceMs?: number;
}

export interface EventBlockProps {
  event: CalendarEvent;
  day: number;
  date: DateTime;
  style: { top: number; left: number; width: number; height: number };
  editing: boolean;
  selection: SelectionStore;
  focusStore: GridFocusStore;
  restoreFocus: (
    opener: Element | null,
    event: CalendarEvent,
    day: number,
  ) => void;
  onPointerDown: (
    e: PointerEvent,
    type: "move" | "resize_start" | "resize_end",
    event: CalendarEvent,
    day: number,
  ) => void;
  onEventEdit: (originalEvent: CalendarEvent, event: CalendarEvent) => void;
  onEventMove: (originalEvent: CalendarEvent, event: CalendarEvent) => void;
  onEventDelete: (event: CalendarEvent) => void;
  onDuplicate: (event: CalendarEvent) => void;
  onDetach: (event: CalendarEvent) => void;
  onReset: (event: CalendarEvent) => void;
  setEditingEvent: (event: CalendarEvent | null, day?: number | null) => void;
}
