import { getTimezoneShortLabel } from "@/lib/calendar/timezone";

export const GRID_HEADER_HEIGHT = 48;
export const NO_BOTTOM_BORDER =
  "shadow-[inset_-1px_0_0_0_color-mix(in_srgb,var(--foreground)_calc(var(--line-opacity)*1%),transparent)]";
export const BOTTOM_BORDER_ONLY =
  "shadow-[inset_0_-1px_0_0_color-mix(in_srgb,var(--foreground)_calc(var(--line-opacity)*1%),transparent)]";
export const ALL_DAY_CELL =
  "select-none sticky z-16 shadow-[inset_-1px_-1px_0_0_color-mix(in_srgb,var(--foreground)_calc(var(--line-opacity)*1%),transparent)] bg-background";

const TIMEZONE_COL_MIN_WIDTH = "3.5rem";
const TIMEZONE_COL_MAX_WIDTH = "6rem";

export const getTimezoneColWidth = (timezones: string[], dayCount: number) => {
  if (timezones.length < 2) return TIMEZONE_COL_MIN_WIDTH;
  const longest = Math.max(
    ...timezones.map((tz) => getTimezoneShortLabel(tz).length),
  );
  const fitsLabel = `clamp(${TIMEZONE_COL_MIN_WIDTH}, ${longest}ch + 0.5rem, ${TIMEZONE_COL_MAX_WIDTH})`;
  return `min(${fitsLabel}, calc(100cqw / ${timezones.length + dayCount}))`;
};

export const timezoneStickyStyle = (
  i: number,
  count: number,
  labelsRight: boolean,
  colWidth: string,
) =>
  labelsRight
    ? { right: `calc(${colWidth} * ${count - 1 - i})` }
    : { left: `calc(${colWidth} * ${i})` };

const gridRows = (h: number, headerBottom: boolean, strip: number) => {
  const stripRow = strip ? `${strip}px` : "";
  return headerBottom
    ? `repeat(24, ${h}px) ${stripRow} 48px`
    : `48px ${stripRow} repeat(24, ${h}px)`;
};

export const GRID_CONFIG = {
  day: {
    cols: (tzCount: number, tzWidth: string, labelsRight: boolean) => {
      const labels = `repeat(${tzCount}, ${tzWidth})`;
      return labelsRight ? `1fr ${labels}` : `${labels} 1fr`;
    },
    rows: gridRows,
  },
  week: {
    cols: (tzCount: number, tzWidth: string, labelsRight: boolean) => {
      const labels = `repeat(${tzCount}, ${tzWidth})`;
      return labelsRight
        ? `repeat(7, 1fr) ${labels}`
        : `${labels} repeat(7, 1fr)`;
    },
    rows: gridRows,
  },
} as const;

export const HOURS = Array.from(
  { length: 24 },
  (_, i) => `${((i + 11) % 12) + 1} ${i < 12 ? "AM" : "PM"}`,
);
