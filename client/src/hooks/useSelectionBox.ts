import {
  edgeScrollSpeed,
  getBoxedKeys,
  SELECT_DRAG_THRESHOLD,
  type KeyedRect,
  type SelectionBoxState,
} from "@/lib/selectionBox";
import { clamp } from "@/lib/utils";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export type SelectionBoxStyle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type SelectionBoxOptions<S> = {
  containerRef: RefObject<HTMLElement | null>;
  getRects: (
    container: HTMLElement,
    offsetX: number,
    offsetY: number,
  ) => KeyedRect[];
  onBox: (keys: Set<string>, session: S) => void;
  onClick: (session: S) => void;
};

export function useSelectionBox<S>(options: SelectionBoxOptions<S>) {
  const [box, setBox] = useState<SelectionBoxStyle | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const begin = useCallback((e: React.PointerEvent, session: S) => {
    const { containerRef, getRects, onBox, onClick } = optionsRef.current;
    const container = containerRef.current;
    if (!container) return;

    const state: SelectionBoxState = {
      pointerId: e.pointerId,
      x0: e.clientX + container.scrollLeft,
      y0: e.clientY + container.scrollTop,
      x1: e.clientX + container.scrollLeft,
      y1: e.clientY + container.scrollTop,
      px: e.clientX,
      py: e.clientY,
      moved: false,
      rects: getRects(container, container.scrollLeft, container.scrollTop),
    };
    let frame = 0;

    const update = () => {
      state.x1 = state.px + container.scrollLeft;
      state.y1 = state.py + container.scrollTop;

      state.moved ||=
        Math.abs(state.x1 - state.x0) > SELECT_DRAG_THRESHOLD ||
        Math.abs(state.y1 - state.y0) > SELECT_DRAG_THRESHOLD;

      if (state.moved) onBox(getBoxedKeys(state), session);

      setBox({
        left: Math.min(state.x0, state.x1) - container.scrollLeft,
        top: Math.min(state.y0, state.y1) - container.scrollTop,
        width: Math.abs(state.x1 - state.x0),
        height: Math.abs(state.y1 - state.y0),
      });
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== state.pointerId) return;

      state.px = ev.clientX;
      state.py = ev.clientY;
      update();
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      setBox(null);
      stopRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (ev.pointerId !== state.pointerId) return;

      if (!state.moved) onClick(session);
      stop();
    };

    const onPointerCancel = (ev: PointerEvent) => {
      if (ev.pointerId === state.pointerId) stop();
    };

    const scrollNearEdge = () => {
      const rect = container.getBoundingClientRect();
      const left = container.scrollLeft;
      const top = container.scrollTop;
      container.scrollLeft = clamp(
        left +
          edgeScrollSpeed(
            state.px,
            Math.max(rect.left, 0),
            Math.min(rect.right, window.innerWidth),
          ),
        0,
        container.scrollWidth - container.clientWidth,
      );
      container.scrollTop = clamp(
        top +
          edgeScrollSpeed(
            state.py,
            Math.max(rect.top, 0),
            Math.min(rect.bottom, window.innerHeight),
          ),
        0,
        container.scrollHeight - container.clientHeight,
      );
      if (container.scrollLeft !== left || container.scrollTop !== top) {
        // sticky blocks (all day strip) move relative to the content on scroll
        state.rects = getRects(
          container,
          container.scrollLeft,
          container.scrollTop,
        );
        update();
      }
      frame = requestAnimationFrame(scrollNearEdge);
    };

    setBox({ left: e.clientX, top: e.clientY, width: 0, height: 0 });
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    stopRef.current?.();
    stopRef.current = stop;
    frame = requestAnimationFrame(scrollNearEdge);
  }, []);

  return { begin, box };
}
