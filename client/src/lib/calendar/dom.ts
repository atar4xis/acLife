import { getKeyedRects } from "@/lib/selectionBox";

export const getDayRects = () =>
  Array.from(document.querySelectorAll("[data-day-index]")).map((el) => ({
    day: Number(el.getAttribute("data-day-index")),
    rect: el.getBoundingClientRect(),
  }));

export const getEventRects = (offsetX: number, offsetY: number) =>
  getKeyedRects(
    document,
    "[data-event-key]",
    "data-event-key",
    offsetX,
    offsetY,
  );
