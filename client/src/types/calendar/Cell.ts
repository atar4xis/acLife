import type { WithChildren } from "../Props";
import type { CalendarEvent } from "./Event";

export type CellProps = React.ComponentProps<"div"> & WithChildren;

export type GridTouchRef = {
  start: {
    x: number;
    y: number;
  };
  delta?: {
    x: number;
    y: number;
  };
  distance?: number;
  raf?: number;
};

export type EventRect = {
  key: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type GridSelectionRef = {
  pointerId: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  moved: boolean;
  toggle?: CalendarEvent;
  base: CalendarEvent[];
  rects: EventRect[];
};
