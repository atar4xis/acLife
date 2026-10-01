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
import { useCalendar } from "@/context/CalendarContext";
import { Settings } from "lucide-react";
import { DateTime } from "luxon";
import UserDropdown from "./user/UserDropdown";
import { useStorage } from "@/context/StorageContext";
import { useEffect, useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import AgendaList from "./calendar/AgendaList";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { useWeekStart } from "@/hooks/useWeekStart";
import { fromPickerDate, toPickerDate } from "@/lib/calendar/date";
import { getEventMap } from "@/lib/calendar/event";
import { EMPTY_ARRAY } from "@/lib/constants";
import type { CalendarEvent } from "@/types/calendar/Event";

export default function AppSidebar({
  onOpenSettings,
}: {
  onOpenSettings: (categoryId?: string) => void;
}) {
  const { currentDate, setCurrentDate, calendarEvents } = useCalendar();
  const { dayPickerWeekStart } = useWeekStart();
  const {
    agendaEnabled,
    miniCalendarEnabled,
    miniCalendarEventBars,
    miniCalendarWeekNumbers,
    miniCalendarBoldDayNumbers,
    miniCalendarDropdowns,
  } = useCalendarSettings((s) => ({
    agendaEnabled: s.agendaEnabled,
    miniCalendarEnabled: s.miniCalendarEnabled,
    miniCalendarEventBars: s.miniCalendarEventBars,
    miniCalendarWeekNumbers: s.miniCalendarWeekNumbers,
    miniCalendarBoldDayNumbers: s.miniCalendarBoldDayNumbers,
    miniCalendarDropdowns: s.miniCalendarDropdowns,
  }));
  const [month, setMonth] = useState(() => toPickerDate(currentDate));

  // keep the mini calendar on the month being viewed
  useEffect(() => {
    setMonth(toPickerDate(currentDate));
  }, [currentDate]);

  const isMobile = useIsMobile();
  const { open, setOpen, setOpenMobile } = useSidebar();
  const storage = useStorage();

  useEffect(() => {
    if (isMobile || !storage) return;

    const lastOpenState = storage.get("sidebarOpen");
    setOpen(lastOpenState);

    // eslint-disable-next-line
  }, [isMobile]);

  useEffect(() => {
    if (isMobile || !storage) return;

    storage.set("sidebarOpen", open);

    // eslint-disable-next-line
  }, [open, isMobile]);

  const bars = useMemo(() => {
    if (!miniCalendarEnabled || !miniCalendarEventBars) return null;

    // visible grid incl. outside days
    const days = Array.from({ length: 49 }, (_, i) =>
      fromPickerDate(month)
        .startOf("month")
        .plus({ days: i - 7 }),
    );
    return layoutBars(
      days.map((d) => d.toISODate()!),
      getEventMap(calendarEvents, days, EMPTY_ARRAY, EMPTY_ARRAY),
    );
  }, [miniCalendarEnabled, miniCalendarEventBars, calendarEvents, month]);

  // stable identity so day buttons keep focus across renders
  const components = useMemo(
    () => ({
      DayButton: (props: React.ComponentProps<typeof CalendarDayButton>) => (
        <CalendarDayButton
          {...props}
          className={cn(
            "relative",
            bars && "@container pb-[56%]",
            miniCalendarBoldDayNumbers && "font-bold",
          )}
        >
          {props.children}
          {bars && (
            <EventBars
              layout={bars.get(fromPickerDate(props.day.date).toISODate()!)}
              prev={
                bars.get(
                  fromPickerDate(props.day.date)
                    .minus({ days: 1 })
                    .toISODate()!,
                )?.slots
              }
              next={
                bars.get(
                  fromPickerDate(props.day.date).plus({ days: 1 }).toISODate()!,
                )?.slots
              }
            />
          )}
        </CalendarDayButton>
      ),
    }),
    [bars, miniCalendarBoldDayNumbers],
  );

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarContent>
        {miniCalendarEnabled && (
          <SidebarGroup>
            <Calendar
              mode="single"
              selected={toPickerDate(currentDate)}
              today={toPickerDate(DateTime.now())}
              onSelect={(date) => {
                if (isMobile) setOpenMobile(false);
                setCurrentDate(date ? fromPickerDate(date) : DateTime.now());
              }}
              className="w-full rounded-md border"
              weekStartsOn={dayPickerWeekStart}
              showWeekNumber={miniCalendarWeekNumbers}
              captionLayout={miniCalendarDropdowns ? "dropdown" : "label"}
              startMonth={new Date(1900, 0)}
              endMonth={new Date(2100, 11)}
              month={month}
              onMonthChange={setMonth}
              components={components}
            />
          </SidebarGroup>
        )}
        {agendaEnabled && <AgendaList />}
      </SidebarContent>
      <SidebarRail enableDrag={true} />
      <SidebarFooter>
        <div className="flex justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Settings"
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
}

type BarSlots = (CalendarEvent | undefined)[];

const BAR_SLOTS = 3;
const barKey = (e?: CalendarEvent) => e && (e._instanceId ?? e.id);

// assigns each event a fixed row so multi-day events line up across days
function layoutBars(
  dateKeys: string[],
  eventMap: Map<string, CalendarEvent[]>,
) {
  const result = new Map<string, { slots: BarSlots; overflow: number }>();
  let prev: BarSlots = [];

  for (const date of dateKeys) {
    const slots: BarSlots = new Array(BAR_SLOTS).fill(undefined);
    const pending: CalendarEvent[] = [];
    const events = [...(eventMap.get(date) ?? [])].sort(
      (a, b) => a.start.toMillis() - b.start.toMillis(),
    );

    for (const e of events) {
      const i = prev.findIndex((p) => barKey(p) === barKey(e));
      if (e._continued && i !== -1) slots[i] = e;
      else pending.push(e);
    }
    for (const e of pending) {
      const i = slots.indexOf(undefined);
      if (i !== -1) slots[i] = e;
    }

    result.set(date, {
      slots,
      overflow: events.length - slots.filter(Boolean).length,
    });
    prev = slots;
  }

  return result;
}

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
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <span className="absolute inset-x-0 bottom-[24%] flex h-[26%] flex-col gap-[11%]">
        {slots.map((e, i) => {
          const joinPrev = !!e && barKey(prev?.[i]) === barKey(e);
          const joinNext = !!e && barKey(next?.[i]) === barKey(e);

          return (
            <span
              key={i}
              className={cn(
                "h-[26%]",
                !joinPrev && "ml-[12%] rounded-l-full",
                !joinNext && "mr-[12%] rounded-r-full",
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
