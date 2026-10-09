import { memo, useCallback, useMemo, useState } from "react";
import { DateTime } from "luxon";
import EventBlock from "@/components/calendar/EventBlock";
import EventEditor from "@/components/calendar/EventEditor";
import GridLayout from "@/components/calendar/GridLayout";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { getDay } from "@/lib/calendar/date";
import { getTimezoneColWidth } from "@/lib/calendar/gridLayout";
import { createGridFocusStore } from "@/lib/calendar/gridFocus";
import { createSelectionStore } from "@/lib/calendar/selection";
import type { CalendarEvent } from "@/types/calendar/Event";
import { useTranslation } from "react-i18next";

const PREVIEW_EVENT: Omit<CalendarEvent, "title" | "description"> = {
  id: "preview",
  color: "#2563eb",
  start: DateTime.fromObject({ hour: 9 }),
  end: DateTime.fromObject({ hour: 10 }),
  timestamp: 0,
};

const PREVIEW_DAYS = getDay(PREVIEW_EVENT.start);
const PREVIEW_HOUR_HEIGHT = 80;
const PREVIEW_BLOCK_STYLE = {
  top: 9 * PREVIEW_HOUR_HEIGHT,
  left: 0,
  width: 100,
  height: PREVIEW_HOUR_HEIGHT,
};

const scrollToMorning = (el: HTMLDivElement | null) => {
  if (el) el.scrollTop = 8 * PREVIEW_HOUR_HEIGHT;
};

const noop = () => {};

export default memo(function EventEditorPreview({
  opacity,
  blur,
  radius,
  lineOpacity,
}: {
  opacity: number;
  blur: number;
  radius: number;
  lineOpacity: number;
}) {
  const { t, i18n } = useTranslation();
  const previewEvent = useMemo<CalendarEvent>(
    () => ({
      ...PREVIEW_EVENT,
      title: t("settings.preview.title"),
      description: t("settings.preview.description"),
    }),
    [t],
  );
  const [focusStore] = useState(createGridFocusStore);
  const [selection] = useState(createSelectionStore);
  const settings = useCalendarSettings((s) => ({
    timezones: s.timezones,
    dayHeaderPosition: s.dayHeaderPosition,
    timeLabelPosition: s.timeLabelPosition,
  }));
  const timezones = useMemo(
    () => settings.timezones.slice(0, 1),
    [settings.timezones],
  );
  const tzColWidth = useMemo(
    () => getTimezoneColWidth(timezones, PREVIEW_DAYS.length),
    [timezones],
  );
  const rtl = i18n.dir() === "rtl";
  const labelsRight =
    settings.timeLabelPosition === "auto"
      ? rtl
      : settings.timeLabelPosition === "right";
  const renderDay = useCallback(
    (day: number, date: DateTime) => (
      <EventBlock
        event={previewEvent}
        day={day}
        date={date}
        style={PREVIEW_BLOCK_STYLE}
        editing={false}
        viewing={false}
        selection={selection}
        focusStore={focusStore}
        restoreFocus={noop}
        onPointerDown={noop}
        onEventEdit={noop}
        onEventMove={noop}
        onEventDelete={noop}
        onDuplicate={noop}
        onDetach={noop}
        onReset={noop}
        setEditingEvent={noop}
        setViewingEvent={noop}
      />
    ),
    [previewEvent, selection, focusStore],
  );

  return (
    <div
      aria-hidden="true"
      inert
      className="pointer-events-none select-none relative isolate flex justify-center py-1 overflow-hidden"
    >
      <GridLayout
        ref={scrollToMorning}
        dir="ltr"
        className="@container absolute left-1/2 top-[calc(50%-120px)] -translate-x-1/2 grid h-72 w-64 overflow-hidden"
        mode="day"
        days={PREVIEW_DAYS}
        timezones={timezones}
        tzColWidth={tzColWidth}
        headerBottom={settings.dayHeaderPosition === "bottom"}
        labelsRight={labelsRight}
        hourHeight={PREVIEW_HOUR_HEIGHT}
        lineOpacity={lineOpacity}
        now={PREVIEW_EVENT.start}
        onHeaderClick={noop}
        onCellTap={noop}
        renderDay={renderDay}
      />
      <div className="relative z-10">
        <EventEditor
          preview={{ opacity, blur, radius }}
          event={previewEvent}
          onSave={noop}
          onMove={noop}
          onDelete={noop}
          onCancel={noop}
          onDuplicate={noop}
          onDetach={noop}
          onReset={noop}
        />
      </div>
    </div>
  );
});
