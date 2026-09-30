import { memo, useState, type CSSProperties } from "react";
import { DateTime } from "luxon";
import EventBlock from "@/components/calendar/EventBlock";
import EventEditor from "@/components/calendar/EventEditor";
import { createGridFocusStore } from "@/lib/calendar/gridFocus";
import type { CalendarEvent } from "@/types/calendar/Event";

const PREVIEW_EVENT: CalendarEvent = {
  id: "preview",
  title: "Preview event",
  description: "A preview for the event editor.",
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
  const [focusStore] = useState(createGridFocusStore);

  return (
    <div
      aria-hidden="true"
      inert
      className="pointer-events-none select-none relative flex justify-center py-1 overflow-hidden"
      style={{ "--line-opacity": lineOpacity } as CSSProperties}
    >
      <div className="absolute left-1/2 top-[calc(50%-120px)] -translate-x-1/2 grid auto-rows-[80px] w-64 border-l border-t border-[color-mix(in_srgb,var(--foreground)_calc(var(--line-opacity)*1%),transparent)]">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="relative bg-background shadow-[inset_-1px_-1px_0_0_color-mix(in_srgb,var(--foreground)_calc(var(--line-opacity)*1%),transparent)]"
          >
            {i === 1 && (
              <EventBlock
                event={PREVIEW_EVENT}
                day={0}
                date={PREVIEW_EVENT.start}
                style={PREVIEW_BLOCK_STYLE}
                editing={false}
                selected={false}
                focusStore={focusStore}
                restoreFocus={noop}
                onPointerDown={noop}
                onEventEdit={noop}
                onEventMove={noop}
                onEventDelete={noop}
                onDuplicate={noop}
              />
            )}
          </div>
        ))}
      </div>
      <div className="relative z-10">
        <EventEditor
          preview={{ opacity, blur, radius }}
          event={PREVIEW_EVENT}
          onSave={noop}
          onMove={noop}
          onDelete={noop}
          onCancel={noop}
          onDuplicate={noop}
        />
      </div>
    </div>
  );
});
