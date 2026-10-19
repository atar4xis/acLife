import { clamp } from "@/lib/utils";

export const SELECT_DRAG_THRESHOLD = 4;
export const AUTO_SCROLL_ZONE = 24;
export const AUTO_SCROLL_SPEED = 20;

export type KeyedRect = {
  key: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type SelectionBoxState = {
  pointerId: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  px: number; // last pointer position, viewport coordinates
  py: number;
  moved: boolean;
  rects: KeyedRect[];
};

export const edgeScrollSpeed = (pointer: number, min: number, max: number) => {
  const depth = Math.max(
    min + AUTO_SCROLL_ZONE - pointer,
    pointer - max + AUTO_SCROLL_ZONE,
  );
  const ease = clamp(depth / AUTO_SCROLL_ZONE, 0, 1) ** 2;
  return Math.round(
    AUTO_SCROLL_SPEED * ease * (pointer < (min + max) / 2 ? -1 : 1),
  );
};

export const getKeyedRects = (
  root: ParentNode,
  selector: string,
  attribute: string,
  offsetX: number,
  offsetY: number,
): KeyedRect[] =>
  Array.from(root.querySelectorAll(selector)).map((el) => {
    const rect = el.getBoundingClientRect();

    return {
      key: el.getAttribute(attribute)!,
      left: rect.left + offsetX,
      right: rect.right + offsetX,
      top: rect.top + offsetY,
      bottom: rect.bottom + offsetY,
    };
  });

export const getBoxedKeys = (state: SelectionBoxState) => {
  const left = Math.min(state.x0, state.x1);
  const right = Math.max(state.x0, state.x1);
  const top = Math.min(state.y0, state.y1);
  const bottom = Math.max(state.y0, state.y1);

  const keys = new Set<string>();

  for (const rect of state.rects) {
    if (
      rect.left <= right &&
      rect.right >= left &&
      rect.top <= bottom &&
      rect.bottom >= top
    ) {
      keys.add(rect.key);
    }
  }

  return keys;
};
