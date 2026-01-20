import type { ViewMode } from "@/types/calendar/ViewMode";
import type { CalendarEvent, EventChange } from "@/types/calendar/Event";
import type { ReactNode, PointerEvent } from "react";
import type { User } from "./User";

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
  style: { top: number; left: number; width: number; height: number };
  onPointerDown: (
    e: PointerEvent,
    type: "move" | "resize_start" | "resize_end",
    event: CalendarEvent,
    day: number,
  ) => void;
  onEventEdit: (event: CalendarEvent) => void;
  onEventDelete: (event: CalendarEvent) => void;
}
