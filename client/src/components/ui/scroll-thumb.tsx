import { cn } from "@/lib/utils";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const HIDE_DELAY_MS = 1500;

const AXES = {
  y: {
    scrollPos: "scrollTop",
    scrollSize: "scrollHeight",
    clientSize: "clientHeight",
    pointer: "clientY",
  },
  x: {
    scrollPos: "scrollLeft",
    scrollSize: "scrollWidth",
    clientSize: "clientWidth",
    pointer: "clientX",
  },
} as const;

export default memo(function ScrollThumb({
  gridRef,
  axis = "y",
}: {
  gridRef: RefObject<HTMLElement | null>;
  axis?: "x" | "y";
}) {
  const { scrollPos, scrollSize, clientSize, pointer } = AXES[axis];
  const [thumb, setThumb] = useState<{ offset: number; size: number } | null>(
    null,
  );
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const thumbSizeRef = useRef(0);
  const dragRef = useRef<{ start: number; startScroll: number } | null>(null);

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
    const total = container[scrollSize];
    const visibleSize = container[clientSize];
    if (total <= visibleSize) {
      thumbSizeRef.current = 0;
      setThumb(null);
      return;
    }
    const size = Math.max((visibleSize / total) * visibleSize, 24);
    const offset =
      (Math.abs(container[scrollPos]) / (total - visibleSize)) *
      (visibleSize - size);
    thumbSizeRef.current = size;
    setThumb((prev) =>
      prev?.offset === offset && prev.size === size ? prev : { offset, size },
    );
    show();
  }, [gridRef, show, scrollPos, scrollSize, clientSize]);

  useEffect(() => {
    const container = gridRef.current;
    if (!container) return;
    container.addEventListener("scroll", update);
    container.addEventListener("pointermove", show);
    const resizes = new ResizeObserver(update);
    const watch = () => {
      resizes.disconnect();
      resizes.observe(container);
      for (const child of container.children) resizes.observe(child);
      update();
    };
    const mutations = new MutationObserver(watch);
    mutations.observe(container, { childList: true });
    watch();
    return () => {
      container.removeEventListener("scroll", update);
      container.removeEventListener("pointermove", show);
      resizes.disconnect();
      mutations.disconnect();
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
        start: e[pointer],
        startScroll: container[scrollPos],
      };
      setVisible(true);
      clearHideTimer();
    },
    [gridRef, clearHideTimer, pointer, scrollPos],
  );

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      const container = gridRef.current;
      if (!drag || !container) return;
      const maxScroll = container[scrollSize] - container[clientSize];
      const track = container[clientSize] - thumbSizeRef.current;
      if (track <= 0) return;
      const rtl =
        axis === "x" && getComputedStyle(container).direction === "rtl";
      const delta = (e[pointer] - drag.start) * (rtl ? -1 : 1);
      const deltaScroll = (delta / track) * maxScroll;
      const next = drag.startScroll + deltaScroll;
      container[scrollPos] = rtl
        ? Math.min(Math.max(next, -maxScroll), 0)
        : Math.min(Math.max(next, 0), maxScroll);
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
  }, [gridRef, show, axis, pointer, scrollPos, scrollSize, clientSize]);

  if (!thumb) return null;

  return (
    <div
      data-testid={axis === "y" ? "scroll-thumb" : "scroll-thumb-x"}
      className={cn(
        "absolute rounded-full bg-foreground/20 hover:bg-foreground/40 z-40",
        axis === "y" ? "inset-e-0.5 w-1" : "bottom-0.5 h-1",
        visible ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
      style={
        axis === "y"
          ? { top: thumb.offset, height: thumb.size }
          : { insetInlineStart: thumb.offset, width: thumb.size }
      }
      onPointerDown={handlePointerDown}
    />
  );
});
