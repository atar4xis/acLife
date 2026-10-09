import {
  useCallback,
  useMemo,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { describeFullDay } from "@/lib/calendar/a11y";
import { isSameDate } from "@/lib/calendar/date";
import {
  GRID_CONFIG,
  HOURS,
  NO_BOTTOM_BORDER,
  timezoneStickyStyle,
} from "@/lib/calendar/gridLayout";
import { getTimezoneHourLabel } from "@/lib/calendar/timezone";
import { cn } from "@/lib/utils";
import GridCell from "./GridCell";
import HeaderCell from "./HeaderCell";
import TimezoneHeaderCell from "./TimezoneHeaderCell";

export default function GridLayout({
  mode,
  days,
  timezones,
  tzColWidth,
  headerBottom,
  labelsRight,
  hourHeight,
  stripHeight = 0,
  lineOpacity,
  now,
  allDayRow,
  onHeaderClick,
  onCellTap,
  renderDay,
  style,
  children,
  ...props
}: ComponentProps<"div"> & {
  mode: keyof typeof GRID_CONFIG;
  days: { date: DateTime; label: string }[];
  timezones: string[];
  tzColWidth: string;
  headerBottom: boolean;
  labelsRight: boolean;
  hourHeight: number;
  stripHeight?: number;
  lineOpacity: number;
  now: DateTime;
  allDayRow?: ReactNode;
  onHeaderClick: (e: React.MouseEvent<HTMLDivElement>, day: number) => void;
  onCellTap: (e: React.PointerEvent, day: number) => void;
  renderDay: (day: number, date: DateTime) => ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const nowHour = now.hour;
  const rtl = i18n.dir() === "rtl";
  const { cols, rows } = GRID_CONFIG[mode];

  const tzStickyStyle = useCallback(
    (i: number) =>
      timezoneStickyStyle(i, timezones.length, labelsRight, tzColWidth),
    [labelsRight, tzColWidth, timezones.length],
  );

  const dayWeekHeaders = useMemo(() => {
    const cells = days.map((d, dayIndex) => (
      <HeaderCell
        key={dayIndex}
        onClick={(e) => onHeaderClick(e, dayIndex)}
        className={cn(
          "select-none",
          headerBottom && "top-auto bottom-0",
          stripHeight > 0 && !headerBottom && NO_BOTTOM_BORDER,
          isSameDate(d.date, now) && "bg-card font-bold",
        )}
        aria-label={
          describeFullDay(d.date) +
          (isSameDate(d.date, now) ? `, ${t("a11y.today")}` : "")
        }
      >
        {d.label}
      </HeaderCell>
    ));
    return rtl ? cells.toReversed() : cells;
  }, [days, now, headerBottom, t, rtl, onHeaderClick, stripHeight]);

  const timezoneHeaderCells = useMemo(
    () =>
      timezones.map((tz, i) => (
        <TimezoneHeaderCell
          key={tz}
          tz={tz}
          multi={timezones.length > 1}
          headerBottom={headerBottom}
          labelsRight={labelsRight}
          style={tzStickyStyle(i)}
        />
      )),
    [timezones, headerBottom, labelsRight, tzStickyStyle],
  );

  const headerRow = labelsRight ? (
    <div role="row" className="contents">
      {dayWeekHeaders}
      {timezoneHeaderCells}
    </div>
  ) : (
    <div role="row" className="contents">
      {timezoneHeaderCells}
      {dayWeekHeaders}
    </div>
  );

  const hourLabels = useMemo(
    () =>
      HOURS.map((_label, hour) => (
        <>
          {timezones.map((tz, i) => (
            <div
              key={tz}
              role="rowheader"
              dir={i18n.dir()}
              className={cn(
                "select-none sticky z-5 shadow-[inset_-1px_-1px_0_0_color-mix(in_srgb,var(--foreground)_calc(var(--line-opacity)*1%),transparent)] flex text-sm items-center justify-center",
                tz === timezones[0] && hour == nowHour
                  ? "bg-card font-bold"
                  : "bg-background",
              )}
              style={tzStickyStyle(i)}
            >
              {getTimezoneHourLabel(days[0].date, hour, tz)}
            </div>
          ))}
        </>
      )),
    [timezones, nowHour, tzStickyStyle, days, i18n],
  );

  const timeGrid = useMemo(
    () =>
      HOURS.map((_label, hour) => {
        const timeLabels = hourLabels[hour];

        return (
          <div key={hour} role="row" className="contents">
            {!labelsRight && timeLabels}

            {(rtl ? days.toReversed() : days).map((d) => {
              const dayIndex = days.indexOf(d);

              return (
                <GridCell
                  key={`${dayIndex}-${hour}`}
                  day={dayIndex}
                  onCellTap={onCellTap}
                >
                  {hour === 0 && (
                    <div className="pointer-events-none relative h-full">
                      <div
                        className="pointer-events-none"
                        style={{ height: hourHeight * 24 }}
                      />

                      {renderDay(dayIndex, d.date)}
                    </div>
                  )}
                </GridCell>
              );
            })}

            {labelsRight && timeLabels}
          </div>
        );
      }),
    [days, hourHeight, renderDay, onCellTap, hourLabels, labelsRight, rtl],
  );

  return (
    <div
      {...props}
      style={{
        ...style,
        ...({ "--line-opacity": lineOpacity } as CSSProperties),
        gridTemplateColumns: cols(timezones.length, tzColWidth, labelsRight),
        gridTemplateRows: rows(hourHeight, headerBottom, stripHeight),
      }}
    >
      {!headerBottom && headerRow}
      {!headerBottom && allDayRow}
      {timeGrid}
      {headerBottom && allDayRow}
      {headerBottom && headerRow}
      {children}
    </div>
  );
}
