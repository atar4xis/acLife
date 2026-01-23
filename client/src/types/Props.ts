import type { ViewMode } from "@/types/calendar/ViewMode";
import type { CalendarEvent, EventChange } from "@/types/calendar/Event";
import type { ReactNode, PointerEvent } from "react";
import type { User } from "./User";
import type { DateTime } from "luxon";

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
  ) => void;
  syncEvents: (user: User, masterKey: CryptoKey) => Promise<CalendarEvent[]>;
}

export interface EventBlockProps {
  event: CalendarEvent;
  day: number;
  date: DateTime;
  style: { top: number; left: number; width: number; height: number };
  editing: boolean;
  onPointerDown: (
    e: PointerEvent,
    type: "move" | "resize_start" | "resize_end",
    event: CalendarEvent,
    day: number,
  ) => void;
  onEventEdit: (originalEvent: CalendarEvent, event: CalendarEvent) => void;
  onEventDelete: (event: CalendarEvent) => void;
}
