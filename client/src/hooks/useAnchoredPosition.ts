import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { clamp } from "@/lib/utils";

export default function useAnchoredPosition(
  panelRef: RefObject<HTMLElement | null>,
  anchorRef?: RefObject<HTMLElement | null>,
  beside = false,
) {
  const isMobile = useIsMobile();
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const dragged = useRef(false);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef?.current;

    if (!panel || !anchor) return;

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const myRect = panel.getBoundingClientRect();

      const gridLeft =
        anchor.closest('[role="grid"]')?.getBoundingClientRect().left ?? 0;
      const leftSide = rect.left - myRect.width;
      const top = isMobile ? 0 : rect.top - (beside ? 0 : myRect.height * 0.15);
      const left = isMobile
        ? window.innerWidth / 2 - myRect.width / 2
        : beside
          ? leftSide >= gridLeft
            ? leftSide
            : rect.right
          : rect.left + rect.width / 2 - myRect.width / 2;

      if (dragged.current) {
        setPos((p) => ({
          top: clamp(p.top, 0, window.innerHeight - myRect.height),
          left: clamp(p.left, 0, window.innerWidth - myRect.width),
        }));
        return;
      }

      setPos({
        top: clamp(top, 0, window.innerHeight - myRect.height),
        left: clamp(left, 0, window.innerWidth - myRect.width),
      });
    };

    updatePosition();

    const ro = new ResizeObserver(updatePosition);
    ro.observe(panel);

    return () => ro.disconnect();
  }, [isMobile, panelRef, anchorRef, beside]);

  const startDrag = (e: React.PointerEvent) => {
    const panel = panelRef.current;
    if (
      isMobile ||
      e.button !== 0 ||
      !panel ||
      (e.target as Element).closest("button")
    )
      return;

    const { width, height } = panel.getBoundingClientRect();
    const dx = e.clientX - pos.left;
    const dy = e.clientY - pos.top;
    const onMove = (m: PointerEvent) => {
      dragged.current = true;
      setPos({
        top: clamp(m.clientY - dy, 0, window.innerHeight - height),
        left: clamp(m.clientX - dx, 0, window.innerWidth - width),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return { pos, startDrag, isMobile };
}
