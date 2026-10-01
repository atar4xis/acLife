import { memo, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { getTimezoneShortLabel } from "@/lib/calendar/timezone";

export default memo(function TimezoneHeaderCell({
  tz,
  multi,
  headerBottom,
  labelsRight,
  style,
}: {
  tz: string;
  multi: boolean;
  headerBottom: boolean;
  labelsRight: boolean;
  style: CSSProperties;
}) {
  const [truncated, setTruncated] = useState(false);
  const labelRef = useRef<HTMLSpanElement>(null);
  return (
    <div
      role={multi ? "columnheader" : "presentation"}
      aria-label={multi ? tz : undefined}
      className={cn(
        "select-none sticky z-16 hover:z-20 shadow-[inset_-1px_-1px_0_0_color-mix(in_srgb,var(--foreground)_calc(var(--line-opacity)*1%),transparent)] flex items-center justify-center bg-background text-xs text-muted-foreground px-1",
        headerBottom ? "bottom-0" : "top-0",
      )}
      style={style}
      onMouseEnter={() => {
        const el = labelRef.current;
        setTruncated(!!el && el.scrollWidth > el.clientWidth);
      }}
      onMouseLeave={() => setTruncated(false)}
    >
      {multi ? (
        <span
          ref={labelRef}
          className={cn(
            "truncate",
            truncated &&
              "absolute inset-y-0 w-max min-w-full overflow-visible bg-background ring-1 ring-inset ring-border px-1 flex items-center justify-center",
            truncated && (labelsRight ? "right-0" : "left-0"),
          )}
        >
          {getTimezoneShortLabel(tz)}
        </span>
      ) : null}
    </div>
  );
});
