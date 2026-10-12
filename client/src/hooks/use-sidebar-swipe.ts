import { clamp } from "@/lib/utils";
import { type CSSProperties, useEffect, useEffectEvent, useState } from "react";

const OPEN_ZONE_PX = 50;
const SWIPE_PX = 16;

export function useSidebarSwipe(
  side: "left" | "right",
  open: boolean,
  setOpen: (open: boolean) => void,
  rem: number,
  enabled: boolean,
): CSSProperties | undefined {
  const [hidden, setHidden] = useState<number | null>(null);
  const isOpen = useEffectEvent(() => open);

  useEffect(() => {
    if (!enabled || !open) return;

    history.pushState({ sidebar: true }, "");
    const close = () => setOpen(false);
    addEventListener("popstate", close);
    return () => {
      removeEventListener("popstate", close);
      if (history.state?.sidebar) history.back();
    };
  }, [enabled, open, setOpen]);

  useEffect(() => {
    if (!enabled) return;

    const sign = side === "left" ? 1 : -1;
    let start: { x: number; y: number } | undefined;
    let wasOpen = false;
    let width = 0;
    let dragging = false;

    const hiddenAt = (x: number) =>
      clamp((wasOpen ? 0 : width) - (x - start!.x) * sign, 0, width);

    const onStart = (e: TouchEvent) => {
      const { clientX: x, clientY: y } = e.touches[0];
      wasOpen = isOpen();
      const fromSide = side === "left" ? x : innerWidth - x;
      start = wasOpen || fromSide <= OPEN_ZONE_PX ? { x, y } : undefined;
      dragging = false;
      width =
        rem * parseFloat(getComputedStyle(document.documentElement).fontSize);
    };

    const onMove = (e: TouchEvent) => {
      if (!start) return;

      const { clientX: x, clientY: y } = e.touches[0];
      if (!dragging) {
        const along = (x - start.x) * sign * (wasOpen ? -1 : 1);
        const across = Math.abs(y - start.y);
        if (Math.max(Math.abs(along), across) < SWIPE_PX) return;
        if (along < 2 * across) {
          start = undefined;
          return;
        }
        dragging = true;
        setOpen(true);
      }

      e.preventDefault();
      setHidden(hiddenAt(x));
    };

    const onEnd = (e: TouchEvent) => {
      if (start && dragging) {
        e.preventDefault();
        setOpen(hiddenAt(e.changedTouches[0].clientX) < width / 2);
        setHidden(null);
      }
      start = undefined;
    };

    const opts = { passive: false };
    addEventListener("touchstart", onStart, opts);
    addEventListener("touchmove", onMove, opts);
    addEventListener("touchend", onEnd, opts);
    addEventListener("touchcancel", onEnd, opts);
    return () => {
      removeEventListener("touchstart", onStart);
      removeEventListener("touchmove", onMove);
      removeEventListener("touchend", onEnd);
      removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, side, rem, setOpen]);

  if (hidden === null) return undefined;
  return { transform: `translateX(${side === "left" ? -hidden : hidden}px)` };
}
