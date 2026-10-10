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
  useDragging,
  useEventList,
} from "@/context/CalendarContext";
import { BookText, CalendarDays, Settings } from "lucide-react";
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
  BAR_GAP,
  BAR_HEIGHT,
  BAR_SLOTS,
  BARS_AREA,
  BARS_BOTTOM,
  layoutBars,
  numberPadding,
  sameBars,
} from "@/lib/calendar/eventBars";
import { EMPTY_ARRAY } from "@/lib/constants";
import { useTranslation } from "react-i18next";
import JournalSidebar from "./journal/JournalSidebar";
import type { AppView } from "@/types/AppView";

const START_MONTH = new Date(1900, 0);
const END_MONTH = new Date(2100, 11);

const toPickerMonth = (date: DateTime) => new Date(date.year, date.month - 1);

const sameMonth = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

const DayBarsContext = createContext<{
  bars: ReturnType<typeof layoutBars> | null;
  bold: boolean;
  adaptive: boolean;
}>({ bars: null, bold: false, adaptive: false });

function MiniDayButton(props: React.ComponentProps<typeof CalendarDayButton>) {
  const { bars, bold, adaptive } = useContext(DayBarsContext);
  const day = bars && fromPickerDate(props.day.date);
  const layout = day ? bars.get(day.toISODate()!) : undefined;
  const barRows = layout ? layout.slots.findLastIndex(Boolean) + 1 : 0;

  return (
    <CalendarDayButton
      {...props}
      className={cn("relative", bars && "@container", bold && "font-bold")}
      style={
        bars
          ? {
              paddingBottom: `${numberPadding(adaptive ? barRows : BAR_SLOTS)}%`,
            }
          : undefined
      }
    >
      {props.children}
      {bars && day && (
        <EventBars
          layout={layout}
          fromBottom={adaptive}
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
  adaptive,
  children,
}: {
  month: Date;
  enabled: boolean;
  bold: boolean;
  adaptive: boolean;
  children: React.ReactNode;
}) {
  const events = useEventList();
  const dragging = useDragging();
  const [settled, setSettled] = useState(events);
  if (!dragging && settled !== events) setSettled(events);
  // deferred so the grid paints before the bars are recomputed
  const calendarEvents = useDeferredValue(settled);
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

  const dayBars = useMemo(
    () => ({ bars, bold, adaptive }),
    [bars, bold, adaptive],
  );

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
  const settings = useCalendarSettings((s) => ({
    eventBars: s.miniCalendarEventBars,
    weekNumbers: s.miniCalendarWeekNumbers,
    boldDayNumbers: s.miniCalendarBoldDayNumbers,
    adaptiveNumbers: s.miniCalendarAdaptiveNumbers,
    dropdowns: s.miniCalendarDropdowns,
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
      enabled={settings.eventBars}
      bold={settings.boldDayNumbers}
      adaptive={settings.adaptiveNumbers}
    >
      <Calendar
        mode="single"
        selected={selected}
        today={today}
        onSelect={onSelect}
        className="w-full rounded-md border"
        weekStartsOn={dayPickerWeekStart}
        showWeekNumber={settings.weekNumbers}
        captionLayout={settings.dropdowns ? "dropdown" : "label"}
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
  view,
  onChangeView,
  onOpenSettings,
}: {
  view: AppView;
  onChangeView: (view: AppView) => void;
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

  const switcherView = view === "calendar" ? "journal" : "calendar";

  return (
    <Sidebar collapsible="offcanvas" side={side}>
      {view === "journal" ? (
        <JournalSidebar />
      ) : (
        <SidebarContent>
          {settings.miniCalendarEnabled && (
            <SidebarGroup>
              <MiniCalendar onPick={closeMobile} />
            </SidebarGroup>
          )}
          {settings.agendaEnabled && <AgendaList />}
        </SidebarContent>
      )}
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
            <UserDropdown
              onOpenAccountSettings={() => onOpenSettings("security")}
            />
          </div>

          <Button
            variant="outline"
            size="icon"
            aria-label={t(`views.${switcherView}`)}
            onClick={() => onChangeView(switcherView)}
          >
            {view === "calendar" ? <BookText /> : <CalendarDays />}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
});

function EventBars({
  layout,
  fromBottom,
  prev,
  next,
}: {
  layout?: { slots: BarSlots; overflow: number };
  fromBottom: boolean;
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
      <span
        className={cn(
          "absolute inset-x-0 flex",
          fromBottom ? "flex-col-reverse" : "flex-col",
        )}
        style={{
          bottom: `${BARS_BOTTOM}%`,
          height: `${BARS_AREA}%`,
          gap: `${BAR_GAP}%`,
        }}
      >
        {slots.map((e, i) => {
          const joinPrev = !!e && barKey(prev?.[i]) === barKey(e);
          const joinNext = !!e && barKey(next?.[i]) === barKey(e);

          return (
            <span
              key={i}
              data-testid={e ? "event-bar" : undefined}
              className={cn(
                !joinPrev && "ms-[12%] rounded-s-full",
                !joinNext && "me-[12%] rounded-e-full",
              )}
              style={{
                height: `${BAR_HEIGHT}%`,
                backgroundColor: e && (e.color ?? "var(--primary)"),
              }}
            />
          );
        })}
        {overflow > 0 && (
          <span className="absolute inset-x-0 top-full mt-0.5 text-center text-[20cqw]! leading-none">
            +{overflow}
          </span>
        )}
      </span>
    </span>
  );
}
