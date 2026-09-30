import type { ViewMode } from "@/types/calendar/ViewMode";

// iso weekday: 1 is Monday, 7 is Sunday
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type WeekStartsOn = "inherit" | Weekday;

export type DayHeaderPosition = "top" | "bottom";
export type TimeLabelPosition = "left" | "right";

export interface CalendarSettings {
  defaultView: ViewMode;
  weekStartsOn: WeekStartsOn;
  snapMinutes: number;
  lineOpacity: number;
  dayHeaderPosition: DayHeaderPosition;
  timeLabelPosition: TimeLabelPosition;
  defaultEventName: string;
  defaultTaskName: string;
  defaultEventDuration: number;
  resyncIntervalMinutes: number;
  agendaEnabled: boolean;
  agendaRangeDays: number;
  eventColorPresets: string[];
  addColorsAutomatically: boolean;
  eventEditorOpacity: number;
  eventEditorBlur: number;
  eventEditorRadius: number;
  timezones: string[];
  defaultTimezone: string;
  lastSeenDeviceTimezone: string;
}
