import { calendarReducer } from "@/reducers/calendarReducer";
import type { CalendarAction } from "@/types/calendar/Action";
import type { CalendarEvent } from "@/types/calendar/Event";
import type { WithChildren } from "@/types/Props";
import { eventKey } from "@/lib/calendar/event";
import { DateTime } from "luxon";
import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  useState,
  type Dispatch,
} from "react";

type CalendarContextValue = {
  currentDate: DateTime;
  setCurrentDate: (date: DateTime) => void;
  calendarEvents: CalendarEvent[];
  dispatch: Dispatch<CalendarAction>;
  editingEvent: CalendarEvent | null;
  editingEventDay: number | null;
  setEditingEvent: (event: CalendarEvent | null, day?: number | null) => void;
  lastPointer: { x: number; y: number } | null;
  setLastPointer: (p: { x: number; y: number } | null) => void;
  selectedEvents: Map<string, CalendarEvent>;
  toggleSelection: (event: CalendarEvent) => void;
  selectEvents: (events: CalendarEvent[]) => void;
  clearSelection: () => void;
};

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function CalendarProvider({ children }: WithChildren) {
  const [currentDate, setCurrentDate] = useState(DateTime.now());
  const [calendarEvents, dispatch] = useReducer(calendarReducer, []);
  const [editingEvent, setEditingEventState] = useState<CalendarEvent | null>(
    null,
  );
  const [editingEventDay, setEditingEventDay] = useState<number | null>(null);
  const [lastPointer, setLastPointer] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [selectedEvents, setSelectedEvents] = useState<
    Map<string, CalendarEvent>
  >(new Map());

  const setEditingEvent = (
    event: CalendarEvent | null,
    day?: number | null,
  ) => {
    setEditingEventState(event);
    setEditingEventDay(day ?? null);
  };

  const toggleSelection = useCallback((event: CalendarEvent) => {
    setSelectedEvents((prev) => {
      const next = new Map(prev);
      const key = eventKey(event);
      if (!next.delete(key)) next.set(key, event);
      return next;
    });
  }, []);

  const selectEvents = useCallback((events: CalendarEvent[]) => {
    setSelectedEvents((prev) => {
      const next = new Map(events.map((e) => [eventKey(e), e]));

      const unchanged =
        next.size === prev.size && [...next.keys()].every((k) => prev.has(k));

      return unchanged ? prev : next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedEvents((prev) => (prev.size === 0 ? prev : new Map()));
  }, []);

  return (
    <CalendarContext.Provider
      value={{
        currentDate,
        calendarEvents,
        editingEvent,
        editingEventDay,
        dispatch,
        setCurrentDate,
        setEditingEvent,
        lastPointer,
        setLastPointer,
        selectedEvents,
        toggleSelection,
        selectEvents,
        clearSelection,
      }}
    >
      {children}
    </CalendarContext.Provider>
  );
}

// eslint-disable-next-line
export function useCalendar() {
  const context = useContext(CalendarContext);
  if (!context)
    throw new Error("useCalendar must be used within a CalendarProvider");
  return context;
}
