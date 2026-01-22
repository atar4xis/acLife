import { calendarReducer } from "@/reducers/calendarReducer";
import type { CalendarAction } from "@/types/calendar/Action";
import type { CalendarEvent } from "@/types/calendar/Event";
import type { WithChildren } from "@/types/Props";
import { DateTime } from "luxon";
import {
  createContext,
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
  setEditingEvent: (event: CalendarEvent | null) => void;
};

const CalendarContext = createContext<CalendarContextValue | null>(null);

export function CalendarProvider({ children }: WithChildren) {
  const [currentDate, setCurrentDate] = useState(DateTime.now());
  const [calendarEvents, dispatch] = useReducer(calendarReducer, []);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  return (
    <CalendarContext.Provider
      value={{
        currentDate,
        calendarEvents,
        editingEvent,
        dispatch,
        setCurrentDate,
        setEditingEvent,
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
