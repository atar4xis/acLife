import { cn } from "@/lib/utils";
import type { ViewMode } from "@/types/calendar/ViewMode";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const HIDE_DELAY_MS = 1500;

export default memo(function ScrollThumb({
  gridRef,
  hourHeight,
  mode,
  visibleDays,
}: {
  gridRef: RefObject<HTMLDivElement | null>;
  hourHeight: number;
  mode: ViewMode;
  visibleDays: readonly unknown[];
}) {
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(
    null,
  );
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const thumbHeightRef = useRef(0);
  const dragRef = useRef<{ startY: number; startScrollTop: number } | null>(
    null,
  );

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    setVisible(true);
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false);
    }, HIDE_DELAY_MS);
  }, [clearHideTimer]);

  useEffect(() => clearHideTimer, [clearHideTimer]);

  const update = useCallback(() => {
    const container = gridRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight <= clientHeight) {
      thumbHeightRef.current = 0;
      setThumb(null);
      return;
    }
    const height = Math.max((clientHeight / scrollHeight) * clientHeight, 24);
    const top =
      (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height);
    thumbHeightRef.current = height;
    setThumb((prev) =>
      prev?.top === top && prev.height === height ? prev : { top, height },
    );
    show();
  }, [gridRef, show]);

  useEffect(() => {
    update();
  }, [update, hourHeight, mode, visibleDays]);

  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;
    container.addEventListener("scroll", update);
    container.addEventListener("pointermove", show);
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => {
      container.removeEventListener("scroll", update);
      container.removeEventListener("pointermove", show);
      observer.disconnect();
    };
  }, [gridRef, update, show]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const container = gridRef.current;
      if (!container) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        startY: e.clientY,
        startScrollTop: container.scrollTop,
      };
      setVisible(true);
      clearHideTimer();
    },
    [gridRef, clearHideTimer],
  );

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      const container = gridRef.current;
      if (!drag || !container) return;
      const { scrollHeight, clientHeight } = container;
      const trackHeight = clientHeight - thumbHeightRef.current;
      if (trackHeight <= 0) return;
      const deltaY = e.clientY - drag.startY;
      const deltaScroll =
        (deltaY / trackHeight) * (scrollHeight - clientHeight);
      container.scrollTop = Math.min(
        Math.max(drag.startScrollTop + deltaScroll, 0),
        scrollHeight - clientHeight,
      );
    };
    const handlePointerUp = () => {
      if (dragRef.current) show();
      dragRef.current = null;
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [gridRef, show]);

  if (!thumb) return null;

  return (
    <div
      data-testid="scroll-thumb"
      className={cn(
        "absolute right-0.5 w-1 rounded-full bg-foreground/20 hover:bg-foreground/40 z-40 transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
      style={{ top: thumb.top, height: thumb.height }}
      onPointerDown={handlePointerDown}
    />
  );
});
