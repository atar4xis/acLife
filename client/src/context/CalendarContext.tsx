import { calendarReducer } from "@/reducers/calendarReducer";
import type { CalendarAction } from "@/types/calendar/Action";
import type { CalendarEvent, EventChange } from "@/types/calendar/Event";
import type { WithChildren } from "@/types/Props";
import {
  createSelectionStore,
  type SelectionStore,
} from "@/lib/calendar/selection";
import { deleteDescriptionSizes } from "@/lib/calendar/descriptionSize";
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

type BlockTarget = { event: CalendarEvent | null; day: number | null };

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
  setViewingEvent: (event: CalendarEvent | null, day?: number | null) => void;
  selection: SelectionStore;
  pendingChanges: Map<string, EventChange[]>;
  eventHandlers: EventHandlers;
  setEventHandlers: (handlers: EventHandlers) => void;
};

const ActionsContext = createContext<CalendarActions | null>(null);
const DateContext = createContext<DateTime | null>(null);
const EventsContext = createContext<CalendarEvent[] | null>(null);
const EditingContext = createContext<BlockTarget | null>(null);
const ViewingContext = createContext<BlockTarget | null>(null);

const retarget =
  (event: CalendarEvent | null, day: number | null = null) =>
  (prev: BlockTarget) =>
    prev.event === event && prev.day === day ? prev : { event, day };

export function CalendarProvider({ children }: WithChildren) {
  const [currentDate, setCurrentDateState] = useState<DateTime>(DateTime.now());
  const [calendarEvents, dispatchRaw] = useReducer(calendarReducer, []);
  const dispatch = useCallback((action: CalendarAction) => {
    if (action.type === "delete") deleteDescriptionSizes([action.id]);
    if (action.type === "merge") deleteDescriptionSizes(action.deletedIds);
    dispatchRaw(action);
  }, []);
  const [editing, setEditing] = useState<BlockTarget>({
    event: null,
    day: null,
  });
  const [viewing, setViewing] = useState<BlockTarget>({
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
    (event: CalendarEvent | null, day?: number | null) =>
      setEditing(retarget(event, day)),
    [],
  );
  const setViewingEvent = useCallback(
    (event: CalendarEvent | null, day?: number | null) =>
      setViewing(retarget(event, day)),
    [],
  );

  const actions = useMemo(
    () => ({
      dispatch,
      setCurrentDate,
      getCurrentDate,
      setEditingEvent,
      setViewingEvent,
      selection,
      pendingChanges,
      eventHandlers,
      setEventHandlers,
    }),
    [
      dispatch,
      setCurrentDate,
      getCurrentDate,
      setEditingEvent,
      setViewingEvent,
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
            <ViewingContext.Provider value={viewing}>
              {children}
            </ViewingContext.Provider>
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

// eslint-disable-next-line
export function useViewing() {
  return useRequired(useContext(ViewingContext), "useViewing");
}
