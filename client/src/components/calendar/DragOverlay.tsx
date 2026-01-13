import type { EventDragRef } from "@/types/calendar/Event";
import type { RefObject } from "react";

export default (function DragOverlay({
  dragRef,
}: {
  dragRef: RefObject<EventDragRef>;
}) {
  if (!dragRef.current?.label) return;

  return (
    <div
      style={{
        position: "fixed",
        top: dragRef.current.y + 16,
        left: dragRef.current.x + 16,
        zIndex: 20,
      }}
      className="bg-background/80 p-1"
    >
      {dragRef.current.label}
    </div>
  );
});
