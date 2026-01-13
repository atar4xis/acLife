import type { WithChildren } from "@/types/Props";
import { DateTime } from "luxon";
import { createContext, useContext, useState } from "react";

type CalendarContextValue = {
  currentDate: DateTime;
  setCurrentDate: (date: DateTime) => void;
};

const CalendarContext = createContext<CalendarContextValue>({
  currentDate: DateTime.now(),
  setCurrentDate: () => {},
});

export function CalendarProvider({ children }: WithChildren) {
  const [currentDate, setCurrentDate] = useState(DateTime.now());

  return (
    <CalendarContext.Provider value={{ currentDate, setCurrentDate }}>
      {children}
    </CalendarContext.Provider>
  );
}

export function useCalendar() {
  const context = useContext(CalendarContext);
  return context;
}
