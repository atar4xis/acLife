import { useRef } from "react";

type TapInteractionOptions = {
  onTap: (e: React.PointerEvent<Element>) => void;
  threshold?: number;
  touchAction?: React.CSSProperties["touchAction"];
};

type TapInteractionHandlers = {
  onPointerDown: (e: React.PointerEvent<Element>) => void;
  onPointerMove: (e: React.PointerEvent<Element>) => void;
  onPointerUp: (e: React.PointerEvent<Element>) => void;
  onPointerCancel: (e: React.PointerEvent<Element>) => void;
};

export default function useTapInteraction({
  onTap,
  threshold = 8,
  touchAction = "pan-y",
}: TapInteractionOptions): {
  handlers: TapInteractionHandlers;
  style: React.CSSProperties;
} {
  const start = useRef({ x: 0, y: 0, time: 0 });
  const moved = useRef(false);
  const pointerId = useRef<number | null>(null);

  const handlers: TapInteractionHandlers = {
    onPointerDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return; // only left click
      if (e.pointerType !== "touch") {
        onTap(e);
        return;
      }
      pointerId.current = e.pointerId;
      start.current = { x: e.clientX, y: e.clientY, time: Date.now() };
      moved.current = false;
    },

    onPointerMove(e) {
      if (e.pointerId !== pointerId.current) return;
      if (
        Math.abs(e.clientX - start.current.x) > threshold ||
        Math.abs(e.clientY - start.current.y) > threshold
      ) {
        moved.current = true;
      }
    },

    onPointerUp(e) {
      if (e.pointerId !== pointerId.current) return;
      if (!moved.current && Date.now() - start.current.time < 300) onTap(e);
      pointerId.current = null;
    },

    onPointerCancel(_) {
      pointerId.current = null;
    },
  };

  const style: React.CSSProperties = { touchAction };

  return { handlers, style };
}
