import { memo, useMemo, useState, type CSSProperties } from "react";
import { DateTime } from "luxon";
import EventBlock from "@/components/calendar/EventBlock";
import EventEditor from "@/components/calendar/EventEditor";
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

const PREVIEW_BLOCK_STYLE = { top: 0, left: 0, width: 100, height: 80 };

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
  const { t } = useTranslation();
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

  return (
    <div
      aria-hidden="true"
      inert
      className="pointer-events-none select-none relative isolate flex justify-center py-1 overflow-hidden"
      style={{ "--line-opacity": lineOpacity } as CSSProperties}
    >
      <div className="absolute left-1/2 top-[calc(50%-120px)] -translate-x-1/2 grid auto-rows-20 w-64 border-s border-t border-[color-mix(in_srgb,var(--foreground)_calc(var(--line-opacity)*1%),transparent)]">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="relative bg-background shadow-[inset_-1px_-1px_0_0_color-mix(in_srgb,var(--foreground)_calc(var(--line-opacity)*1%),transparent)]"
          >
            {i === 1 && (
              <EventBlock
                event={previewEvent}
                day={0}
                date={previewEvent.start}
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
            )}
          </div>
        ))}
      </div>
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
