import type { PointerEvent as ReactPointerEvent } from "react";

const HOLD_MS = 400;
const MOVE_TOLERANCE = 8;

type TouchDragOptions = {
  label: string;
  onStart: () => void;
  onEnd: () => void;
  onOver?: (target: Element) => void;
};

const fire = (type: string, target: Element, x: number, y: number) =>
  target.dispatchEvent(
    new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      dataTransfer: new DataTransfer(),
    }),
  );

export const touchDrag =
  ({ label, onStart, onEnd, onOver }: TouchDragOptions) =>
  (e: ReactPointerEvent) => {
    if (e.pointerType !== "touch") return;

    const startX = e.clientX;
    const startY = e.clientY;
    let x = startX;
    let y = startY;
    let ghost: HTMLElement | null = null;
    let over: Element | null = null;
    let droppable = false;

    const blockScroll = (ev: TouchEvent) => {
      if (ghost) ev.preventDefault();
    };

    const stopClick = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };

    const cleanup = () => {
      clearTimeout(timer);
      ghost?.remove();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", blockScroll);
    };

    const place = () => {
      if (ghost) ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
    };

    const timer = setTimeout(() => {
      ghost = document.createElement("div");
      ghost.textContent = label;
      ghost.className =
        "bg-popover text-popover-foreground pointer-events-none fixed top-0 left-0 z-100 max-w-48 truncate rounded-md border px-3 py-1.5 text-sm shadow-md";
      document.body.append(ghost);
      place();
      onStart();
    }, HOLD_MS);

    const onMove = (ev: PointerEvent) => {
      x = ev.clientX;
      y = ev.clientY;
      if (!ghost) {
        if (Math.hypot(x - startX, y - startY) > MOVE_TOLERANCE) cleanup();
        return;
      }

      place();
      const target = document.elementFromPoint(x, y);
      if (target !== over && over) fire("dragleave", over, x, y);
      over = target;
      if (target) onOver?.(target);
      droppable = !!target && !fire("dragover", target, x, y);
    };

    const onUp = () => {
      if (ghost) {
        if (over && droppable) fire("drop", over, x, y);
        window.addEventListener("click", stopClick, {
          capture: true,
          once: true,
        });
        setTimeout(
          () => window.removeEventListener("click", stopClick, true),
          100,
        );
        onEnd();
      }
      cleanup();
    };

    const onCancel = () => {
      if (ghost) onEnd();
      cleanup();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", blockScroll, { passive: false });
  };
