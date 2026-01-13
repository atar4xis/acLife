export const getDayRects = () =>
  Array.from(document.querySelectorAll("[data-day-index]")).map((el) => ({
    day: Number(el.getAttribute("data-day-index")),
    rect: el.getBoundingClientRect(),
  }));
