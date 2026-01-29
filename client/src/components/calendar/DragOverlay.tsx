import type { EventDragRef } from "@/types/calendar/Event";
import { ArrowLeftCircle, ArrowRightCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export default (function DragOverlay({
  dragRef,
  move,
}: {
  dragRef: RefObject<EventDragRef>;
  move: (steps: number) => void;
}) {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const myRef = useRef<HTMLDivElement>(null);
  const moving = useRef<null | number>(null);

  useEffect(() => {
    const listener = (e: MouseEvent) => {
      setX(e.clientX);
      setY(e.clientY);
    };

    document.addEventListener("pointermove", listener);
    return () => document.removeEventListener("pointermove", listener);
  }, [setX, setY]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (moving.current !== null) move(moving.current);
    }, 650);

    return () => clearInterval(interval);
  }, [move]);

  const handleMoveEnter = useCallback((e: React.PointerEvent) => {
    const el = e.target as HTMLDivElement;
    const steps = el.dataset["steps"];
    if (!steps) return;

    moving.current = Number(steps);
  }, []);

  const handleMoveExit = useCallback(() => {
    moving.current = null;
  }, []);

  if (!dragRef.current?.label) return null;

  const myWidth = myRef.current ? myRef.current.clientWidth : 100;

  return (
    <>
      <div
        className="fixed flex items-center justify-center z-20 left-0 top-0 bottom-0 w-20 bg-background/50 hover:bg-background"
        data-steps="-1"
        onPointerEnter={handleMoveEnter}
        onPointerLeave={handleMoveExit}
      >
        <ArrowLeftCircle size={32} />
      </div>
      <div
        className="fixed flex items-center justify-center z-20 right-0 top-0 bottom-0 w-20 bg-background/50 hover:bg-background"
        data-steps="1"
        onPointerEnter={handleMoveEnter}
        onPointerLeave={handleMoveExit}
      >
        <ArrowRightCircle size={32} />
      </div>
      <div
        ref={myRef}
        style={{
          position: "fixed",
          top: y - 16,
          left:
            x + myWidth + 32 > window.innerWidth ? x - myWidth - 32 : x + 32,
          zIndex: 20,
        }}
        className="text-sm bg-secondary/80 p-1 truncate whitespace-pre rounded"
      >
        {dragRef.current.label}
      </div>
    </>
  );
});
