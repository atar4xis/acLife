import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { resolveWeekStart } from "@/lib/calendar/timezone";

export function useWeekStart() {
  const weekStart = useCalendarSettings((s) =>
    resolveWeekStart(s.weekStartsOn, s.defaultTimezone),
  );

  return {
    // iso weekday, 1 is Monday and 7 is Sunday
    weekStart,
    // react-day-picker weekday, 0 is Sunday
    dayPickerWeekStart: (weekStart % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
  };
}
