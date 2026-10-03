import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  useCalendarActions,
  useCurrentDate,
  useEventList,
} from "@/context/CalendarContext";
import { Settings } from "lucide-react";
import { DateTime } from "luxon";
import UserDropdown from "./user/UserDropdown";
import { useStorage } from "@/context/StorageContext";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import AgendaList from "./calendar/AgendaList";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { useWeekStart } from "@/hooks/useWeekStart";
import { fromPickerDate, toPickerDate } from "@/lib/calendar/date";
import { getEventMap } from "@/lib/calendar/event";
import {
  type BarSlots,
  barKey,
  layoutBars,
  sameBars,
} from "@/lib/calendar/eventBars";
import { EMPTY_ARRAY } from "@/lib/constants";
import { useTranslation } from "react-i18next";

const START_MONTH = new Date(1900, 0);
const END_MONTH = new Date(2100, 11);

const toPickerMonth = (date: DateTime) => new Date(date.year, date.month - 1);

const sameMonth = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

const DayBarsContext = createContext<{
  bars: ReturnType<typeof layoutBars> | null;
  bold: boolean;
}>({ bars: null, bold: false });

function MiniDayButton(props: React.ComponentProps<typeof CalendarDayButton>) {
  const { bars, bold } = useContext(DayBarsContext);
  const day = bars && fromPickerDate(props.day.date);

  return (
    <CalendarDayButton
      {...props}
      className={cn(
        "relative",
        bars && "@container pb-[56%]",
        bold && "font-bold",
      )}
    >
      {props.children}
      {bars && day && (
        <EventBars
          layout={bars.get(day.toISODate()!)}
          prev={bars.get(day.minus({ days: 1 }).toISODate()!)?.slots}
          next={bars.get(day.plus({ days: 1 }).toISODate()!)?.slots}
        />
      )}
    </CalendarDayButton>
  );
}

// module scope keeps DayButton identity stable so day buttons keep focus
const MINI_COMPONENTS = { DayButton: MiniDayButton };

// owns the events subscription so event changes never re-render the day picker
function DayBarsProvider({
  month,
  enabled,
  bold,
  children,
}: {
  month: Date;
  enabled: boolean;
  bold: boolean;
  children: React.ReactNode;
}) {
  // deferred so the grid paints before the bars are recomputed
  const calendarEvents = useDeferredValue(useEventList());
  const barsRef = useRef<ReturnType<typeof layoutBars> | null>(null);

  const bars = useMemo(() => {
    if (!enabled) return null;

    // visible grid incl. outside days
    const days = Array.from({ length: 49 }, (_, i) =>
      fromPickerDate(month)
        .startOf("month")
        .plus({ days: i - 7 }),
    );
    const next = layoutBars(
      days.map((d) => d.toISODate()!),
      getEventMap(calendarEvents, days, EMPTY_ARRAY, EMPTY_ARRAY),
    );

    // keep the previous reference when nothing visible changed
    const prev = barsRef.current;
    return prev && sameBars(prev, next) ? prev : next;
  }, [enabled, calendarEvents, month]);

  useEffect(() => {
    barsRef.current = bars;
  }, [bars]);

  const dayBars = useMemo(() => ({ bars, bold }), [bars, bold]);

  return (
    <DayBarsContext.Provider value={dayBars}>
      {children}
    </DayBarsContext.Provider>
  );
}

const MiniCalendar = memo(function MiniCalendar({
  onPick,
}: {
  onPick: () => void;
}) {
  const currentDate = useCurrentDate();
  const { setCurrentDate } = useCalendarActions();
  const { dayPickerWeekStart } = useWeekStart();
  const {
    miniCalendarEventBars,
    miniCalendarWeekNumbers,
    miniCalendarBoldDayNumbers,
    miniCalendarDropdowns,
  } = useCalendarSettings((s) => ({
    miniCalendarEventBars: s.miniCalendarEventBars,
    miniCalendarWeekNumbers: s.miniCalendarWeekNumbers,
    miniCalendarBoldDayNumbers: s.miniCalendarBoldDayNumbers,
    miniCalendarDropdowns: s.miniCalendarDropdowns,
  }));
  const [month, setMonth] = useState(() => toPickerMonth(currentDate));

  // keep the mini calendar on the month being viewed
  useEffect(() => {
    const next = toPickerMonth(currentDate);
    setMonth((prev) => (sameMonth(prev, next) ? prev : next));
  }, [currentDate]);

  const selected = useMemo(() => toPickerDate(currentDate), [currentDate]);
  const todayKey = DateTime.now().toISODate();
  const today = useMemo(
    () => toPickerDate(DateTime.fromISO(todayKey)),
    [todayKey],
  );

  const onSelect = useCallback(
    (date?: Date) => {
      onPick();
      setCurrentDate(date ? fromPickerDate(date) : DateTime.now());
    },
    [onPick, setCurrentDate],
  );

  return (
    <DayBarsProvider
      month={month}
      enabled={miniCalendarEventBars}
      bold={miniCalendarBoldDayNumbers}
    >
      <Calendar
        mode="single"
        selected={selected}
        today={today}
        onSelect={onSelect}
        className="w-full rounded-md border"
        weekStartsOn={dayPickerWeekStart}
        showWeekNumber={miniCalendarWeekNumbers}
        captionLayout={miniCalendarDropdowns ? "dropdown" : "label"}
        startMonth={START_MONTH}
        endMonth={END_MONTH}
        month={month}
        onMonthChange={setMonth}
        components={MINI_COMPONENTS}
      />
    </DayBarsProvider>
  );
});

export default memo(function AppSidebar({
  onOpenSettings,
}: {
  onOpenSettings: (categoryId?: string) => void;
}) {
  const settings = useCalendarSettings((s) => ({
    agendaEnabled: s.agendaEnabled,
    miniCalendarEnabled: s.miniCalendarEnabled,
  }));
  const isMobile = useIsMobile();
  const { open, setOpen, setOpenMobile, width, setWidth } = useSidebar();
  const storage = useStorage();

  const closeMobile = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const { t, i18n } = useTranslation();
  const side = i18n.dir() === "rtl" ? "right" : "left";
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (isMobile || !storage.ready) return;

    setOpen(storage.get("sidebarOpen"));
    const lastWidth = storage.get("sidebarWidth");
    if (lastWidth) setWidth(lastWidth);
    setRestored(true);

    // eslint-disable-next-line
  }, [isMobile, storage.ready]);

  useEffect(() => {
    if (isMobile || !restored) return;

    storage.set("sidebarOpen", open);

    // eslint-disable-next-line
  }, [open, isMobile, restored]);

  useEffect(() => {
    if (isMobile || !restored) return;

    storage.set("sidebarWidth", width);

    // eslint-disable-next-line
  }, [width, isMobile, restored]);

  return (
    <Sidebar collapsible="offcanvas" side={side}>
      <SidebarContent>
        {settings.miniCalendarEnabled && (
          <SidebarGroup>
            <MiniCalendar onPick={closeMobile} />
          </SidebarGroup>
        )}
        {settings.agendaEnabled && <AgendaList />}
      </SidebarContent>
      <SidebarRail enableDrag={true} side={side} />
      <SidebarFooter>
        <div className="flex justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label={t("common.settings")}
              onClick={() => onOpenSettings()}
            >
              <Settings />
            </Button>
          </div>

          <UserDropdown
            onOpenAccountSettings={() => onOpenSettings("security")}
          />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
});

function EventBars({
  layout,
  prev,
  next,
}: {
  layout?: { slots: BarSlots; overflow: number };
  prev?: BarSlots;
  next?: BarSlots;
}) {
  if (!layout?.slots.some(Boolean)) return null;
  const { slots, overflow } = layout;

  return (
    <span
      aria-hidden
      data-testid="event-bars"
      className="pointer-events-none absolute inset-0"
    >
      <span className="absolute inset-x-0 bottom-[24%] flex h-[26%] flex-col gap-[11%]">
        {slots.map((e, i) => {
          const joinPrev = !!e && barKey(prev?.[i]) === barKey(e);
          const joinNext = !!e && barKey(next?.[i]) === barKey(e);

          return (
            <span
              key={i}
              data-testid={e ? "event-bar" : undefined}
              className={cn(
                "h-[26%]",
                !joinPrev && "ms-[12%] rounded-s-full",
                !joinNext && "me-[12%] rounded-e-full",
              )}
              style={{
                backgroundColor: e && (e.color ?? "var(--primary)"),
              }}
            />
          );
        })}
        {overflow > 0 && (
          <span className="absolute inset-x-0 top-full mt-[2px] text-center text-[length:20cqw]! leading-none">
            +{overflow}
          </span>
        )}
      </span>
    </span>
  );
}
