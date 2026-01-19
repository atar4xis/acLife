import type { EventDragRef } from "@/types/calendar/Event";
import { useEffect, useRef, useState, type RefObject } from "react";

export default (function DragOverlay({
  dragRef,
}: {
  dragRef: RefObject<EventDragRef>;
}) {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const myRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listener = (e: MouseEvent) => {
      setX(e.clientX);
      setY(e.clientY);
    };

    document.addEventListener("pointermove", listener);
    return () => document.removeEventListener("pointermove", listener);
  }, [setX, setY]);

  if (!dragRef.current?.label) return null;

  const myWidth = myRef.current ? myRef.current.clientWidth : 100;

  return (
    <div
      ref={myRef}
      style={{
        position: "fixed",
        top: y - 16,
        left: x + myWidth > window.innerWidth ? x - myWidth - 16 : x + 16,
        zIndex: 20,
      }}
      className="bg-background/80 p-1 truncate"
    >
      {dragRef.current.label}
    </div>
  );
});
