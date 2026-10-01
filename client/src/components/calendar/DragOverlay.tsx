import { eventKey } from "@/lib/calendar/event";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import type { EventDragRef } from "@/types/calendar/Event";
import { ArrowLeftCircle, ArrowRightCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export default (function DragOverlay({
  dragRef,
  move,
  anchored = false,
}: {
  dragRef: RefObject<EventDragRef>;
  move: (steps: number) => void;
  anchored?: boolean;
}) {
  const isMobile = useIsMobile();
  const edgeWidth = isMobile ? 32 : 64;
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const myRef = useRef<HTMLDivElement>(null);
  const [direction, setDirection] = useState<null | number>(null);
  const [, remeasure] = useState(0);

  // the event block has moved by now, so measure it again
  useLayoutEffect(() => {
    if (anchored) remeasure((tick) => tick + 1);
  }, [anchored, dragRef.current?.label]);

  useEffect(() => {
    const listener = (e: PointerEvent) => {
      setX(e.clientX);
      setY(e.clientY);

      if (e.pointerType === "touch") {
        const edge =
          e.clientX <= edgeWidth
            ? -1
            : e.clientX >= window.innerWidth - edgeWidth
              ? 1
              : null;
        setDirection(edge);
      }
    };

    document.addEventListener("pointermove", listener);
    return () => document.removeEventListener("pointermove", listener);
  }, [edgeWidth]);

  useEffect(() => {
    if (direction === null) return;

    const timeout = window.setTimeout(() => move(direction), 650);
    return () => window.clearTimeout(timeout);
  }, [move, direction]);

  const handleMoveEnter = useCallback((e: React.PointerEvent) => {
    const el = e.target as HTMLDivElement;
    const steps = el.dataset["steps"];
    if (!steps) return;

    setDirection(Number(steps));
  }, []);

  const handleMoveExit = useCallback(() => {
    setDirection(null);
  }, []);

  if (!dragRef.current?.label) return null;

  const myWidth = myRef.current ? myRef.current.clientWidth : 100;
  const myHeight = myRef.current ? myRef.current.clientHeight : 28;

  let top = y - 16;
  let left = x + myWidth + 32 > window.innerWidth ? x - myWidth - 32 : x + 32;

  if (isMobile || anchored) {
    const key = eventKey(dragRef.current.event);
    const rects = Array.from(
      document.querySelectorAll(`[data-event-key="${key}"]`),
    ).map((el) => el.getBoundingClientRect());
    const rect =
      rects.find((r) => y >= r.top && y <= r.bottom && x >= r.left) ?? rects[0];

    if (rect) {
      const gap = 8;
      top =
        rect.top - myHeight - gap >= 0
          ? rect.top - myHeight - gap
          : rect.bottom + gap;
      top = Math.max(0, Math.min(top, window.innerHeight - myHeight));
      left = rect.left + rect.width / 2 - myWidth / 2;
      left = Math.max(0, Math.min(left, window.innerWidth - myWidth));
    }
  }

  return (
    <>
      {!anchored && (
        <>
          <div
            aria-hidden="true"
            className={cn(
              "fixed flex items-center justify-center z-20 left-0 top-0 bottom-0 bg-background hover:opacity-100",
              isMobile ? "w-8" : "w-16",
              direction === -1 ? "opacity-100" : "opacity-30",
            )}
            data-steps="-1"
            onPointerEnter={handleMoveEnter}
            onPointerLeave={handleMoveExit}
          >
            <ArrowLeftCircle size={isMobile ? 16 : 32} />
          </div>
          <div
            aria-hidden="true"
            className={cn(
              "fixed flex items-center justify-center z-20 right-0 top-0 bottom-0 bg-background hover:opacity-100",
              isMobile ? "w-8" : "w-16",
              direction === 1 ? "opacity-100" : "opacity-30",
            )}
            data-steps="1"
            onPointerEnter={handleMoveEnter}
            onPointerLeave={handleMoveExit}
          >
            <ArrowRightCircle size={isMobile ? 16 : 32} />
          </div>
        </>
      )}
      <div
        aria-hidden="true"
        ref={myRef}
        style={{
          position: "fixed",
          top,
          left,
          zIndex: 50,
        }}
        className="text-sm bg-secondary/80 p-1 truncate whitespace-pre rounded"
      >
        {dragRef.current.label}
      </div>
    </>
  );
});
