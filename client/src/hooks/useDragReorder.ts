import { useEffect, useRef, useState } from "react";

const DRAG_MOVE_THRESHOLD = 6;

// pointer-based list reordering that works for mouse and touch alike;
// native HTML5 drag-and-drop (draggable/onDragStart) has no touch support.
// reordering is done entirely in local state while dragging and only
// reported via onCommit once the pointer is released, so a slow/expensive
// commit (e.g. persisting settings) can't stall the drag itself
export function useDragReorder<T>(items: T[], onCommit: (items: T[]) => void) {
  const [order, setOrder] = useState(items);
  const orderRef = useRef(order);
  orderRef.current = order;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const dragging = useRef(false);

  useEffect(() => {
    if (!dragging.current) setOrder(items);
  }, [items]);

  const setItemRef = (index: number) => (el: HTMLElement | null) => {
    itemRefs.current[index] = el;
  };

  const indexAtPoint = (x: number, y: number) => {
    for (let i = 0; i < itemRefs.current.length; i++) {
      const rect = itemRefs.current[i]?.getBoundingClientRect();
      if (
        rect &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return i;
      }
    }
    return null;
  };

  const onPointerDown =
    (index: number, onTap?: () => void) => (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const start = { x: e.clientX, y: e.clientY };
      let moved = false;
      let current = index;
      setDragIndex(index);

      const handleMove = (ev: PointerEvent) => {
        if (
          !moved &&
          Math.hypot(ev.clientX - start.x, ev.clientY - start.y) >
            DRAG_MOVE_THRESHOLD
        ) {
          moved = true;
          dragging.current = true;
        }
        if (!moved) return;

        const target = indexAtPoint(ev.clientX, ev.clientY);
        if (target !== null && target !== current) {
          const from = current;
          setOrder((prev) =>
            prev.toSpliced(from, 1).toSpliced(target, 0, prev[from]),
          );
          current = target;
          setDragIndex(target);
        }
      };

      const finish = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        setDragIndex(null);
        dragging.current = false;
        if (moved) onCommit(orderRef.current);
        else onTap?.();
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    };

  const onKeyDown = (index: number) => (e: React.KeyboardEvent) => {
    if (!e.shiftKey) return;
    const delta =
      e.key === "ArrowUp" || e.key === "ArrowLeft"
        ? -1
        : e.key === "ArrowDown" || e.key === "ArrowRight"
          ? 1
          : 0;
    if (!delta) return;
    e.preventDefault();

    const target = index + delta;
    const prev = orderRef.current;
    if (target < 0 || target >= prev.length) return;
    const next = prev.toSpliced(index, 1).toSpliced(target, 0, prev[index]);
    setOrder(next);
    onCommit(next);
  };

  return { order, dragIndex, onPointerDown, onKeyDown, setItemRef };
}
