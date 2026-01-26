import type { WithChildren } from "../Props";

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
