import { calendarReducer } from "@/reducers/calendarReducer";
import type { CalendarAction } from "@/types/calendar/Action";
import type { CalendarEvent, EventChange } from "@/types/calendar/Event";
import type { WithChildren } from "@/types/Props";
import {
  createSelectionStore,
  type SelectionStore,
} from "@/lib/calendar/selection";
import { DateTime } from "luxon";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

type EditingState = { event: CalendarEvent | null; day: number | null };

type EventHandlers = {
  edit: (originalEvent: CalendarEvent, event: CalendarEvent) => void;
  move: (originalEvent: CalendarEvent, event: CalendarEvent) => void;
  remove: (event: CalendarEvent) => void;
  duplicate: (event: CalendarEvent) => void;
  detach: (event: CalendarEvent) => void;
  reset: (event: CalendarEvent) => void;
};

const HANDLER_KEYS = [
  "edit",
  "move",
  "remove",
  "duplicate",
  "detach",
  "reset",
] as const;

type CalendarActions = {
  dispatch: Dispatch<CalendarAction>;
  setCurrentDate: Dispatch<SetStateAction<DateTime>>;
  getCurrentDate: () => DateTime;
  setEditingEvent: (event: CalendarEvent | null, day?: number | null) => void;
  selection: SelectionStore;
  pendingChanges: Map<string, EventChange[]>;
  eventHandlers: EventHandlers;
  setEventHandlers: (handlers: EventHandlers) => void;
};

const ActionsContext = createContext<CalendarActions | null>(null);
const DateContext = createContext<DateTime | null>(null);
const EventsContext = createContext<CalendarEvent[] | null>(null);
const EditingContext = createContext<EditingState | null>(null);

export function CalendarProvider({ children }: WithChildren) {
  const [currentDate, setCurrentDateState] = useState(DateTime.now());
  const [calendarEvents, dispatch] = useReducer(calendarReducer, []);
  const [editing, setEditing] = useState<EditingState>({
    event: null,
    day: null,
  });
  const [selection] = useState(createSelectionStore);
  const [pendingChanges] = useState(() => new Map<string, EventChange[]>());

  const currentDateRef = useRef(currentDate);
  const getCurrentDate = useCallback(() => currentDateRef.current, []);
  const setCurrentDate = useCallback((value: SetStateAction<DateTime>) => {
    const next =
      typeof value === "function" ? value(currentDateRef.current) : value;
    currentDateRef.current = next;
    setCurrentDateState(next);
  }, []);

  // a ref keeps the handlers stable while the calendar re-registers them
  const handlersRef = useRef<EventHandlers | null>(null);
  const eventHandlers = useMemo(
    () =>
      Object.fromEntries(
        HANDLER_KEYS.map((key) => [
          key,
          (...args: unknown[]) =>
            (handlersRef.current?.[key] as (...a: unknown[]) => void)?.(
              ...args,
            ),
        ]),
      ) as EventHandlers,
    [],
  );
  const setEventHandlers = useCallback((handlers: EventHandlers) => {
    handlersRef.current = handlers;
  }, []);

  const setEditingEvent = useCallback(
    (event: CalendarEvent | null, day?: number | null) => {
      setEditing((prev) =>
        prev.event === event && prev.day === (day ?? null)
          ? prev
          : { event, day: day ?? null },
      );
    },
    [],
  );

  const actions = useMemo(
    () => ({
      dispatch,
      setCurrentDate,
      getCurrentDate,
      setEditingEvent,
      selection,
      pendingChanges,
      eventHandlers,
      setEventHandlers,
    }),
    [
      setCurrentDate,
      getCurrentDate,
      setEditingEvent,
      selection,
      pendingChanges,
      eventHandlers,
      setEventHandlers,
    ],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <DateContext.Provider value={currentDate}>
        <EventsContext.Provider value={calendarEvents}>
          <EditingContext.Provider value={editing}>
            {children}
          </EditingContext.Provider>
        </EventsContext.Provider>
      </DateContext.Provider>
    </ActionsContext.Provider>
  );
}

const useRequired = <T,>(value: T | null, hook: string): T => {
  if (value === null)
    throw new Error(`${hook} must be used within a CalendarProvider`);
  return value;
};

// eslint-disable-next-line
export function useCalendarActions() {
  return useRequired(useContext(ActionsContext), "useCalendarActions");
}

// eslint-disable-next-line
export function useCurrentDate() {
  return useRequired(useContext(DateContext), "useCurrentDate");
}

// eslint-disable-next-line
export function useEventList() {
  return useRequired(useContext(EventsContext), "useEventList");
}

// eslint-disable-next-line
export function useEditing() {
  return useRequired(useContext(EditingContext), "useEditing");
}
