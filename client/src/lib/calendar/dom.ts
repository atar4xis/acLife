import type { EventRect } from "@/types/calendar/Cell";

export const getDayRects = () =>
  Array.from(document.querySelectorAll("[data-day-index]")).map((el) => ({
    day: Number(el.getAttribute("data-day-index")),
    rect: el.getBoundingClientRect(),
  }));

export const getEventRects = (offsetX: number, offsetY: number): EventRect[] =>
  Array.from(document.querySelectorAll("[data-event-key]")).map((el) => {
    const rect = el.getBoundingClientRect();

    return {
      key: el.getAttribute("data-event-key")!,
      left: rect.left + offsetX,
      right: rect.right + offsetX,
      top: rect.top + offsetY,
      bottom: rect.bottom + offsetY,
    };
  });
