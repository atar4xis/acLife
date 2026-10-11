export const SCROLL_INTERRUPTS = [
  "wheel",
  "touchstart",
  "pointerdown",
  "keydown",
];
export const FOLLOW_MS = 8000;
export const MAX_DRIFT = 0.25;

export type JournalEditorHandle = {
  focus: () => void;
  topLine: (top: number) => number;
  scrollToLine: (line: number) => void;
};

const lined = (box: HTMLElement) =>
  Array.from(box.querySelectorAll<HTMLElement>("[data-line]")).flatMap((el) => {
    const footnotes = el.closest("[data-footnotes]");
    if (footnotes && footnotes !== el) return [];
    const block = el.closest<HTMLElement>("[data-block-start]");
    const line = Number(el.dataset.line);
    const start = line + (block ? Number(block.dataset.blockStart) - 1 : 0);
    return [{ el, start, count: Number(el.dataset.endLine) - line + 1 }];
  });

const codeBlock = (el: HTMLElement) =>
  el.tagName === "CODE" && el.parentElement?.tagName === "PRE"
    ? el.parentElement
    : null;

const codeMetrics = (pre: HTMLElement) => {
  const style = getComputedStyle(pre);
  return {
    top: pre.getBoundingClientRect().top + parseFloat(style.paddingTop),
    lineHeight: parseFloat(style.lineHeight),
  };
};

export const readerTopLine = (box: HTMLElement) => {
  const top = box.getBoundingClientRect().top;
  const blocks = lined(box);
  const inside = blocks
    .filter(({ el }) => {
      const rect = el.getBoundingClientRect();
      return rect.top <= top && rect.bottom > top;
    })
    .pop();
  const pre = inside && codeBlock(inside.el);
  if (inside && pre) {
    const { top: first, lineHeight } = codeMetrics(pre);
    const row = Math.min(
      Math.max((top - first) / lineHeight, 0),
      inside.count - 0.01,
    );
    return inside.start + row;
  }
  if (inside) {
    const rect = inside.el.getBoundingClientRect();
    return inside.start + ((top - rect.top) / rect.height) * inside.count;
  }
  const below = blocks.find(({ el }) => el.getBoundingClientRect().top > top);
  const last = blocks[blocks.length - 1];
  return below?.start ?? (last ? last.start + last.count : 1);
};

export const scrollReaderToLine = (box: HTMLElement, line: number) => {
  const blocks = lined(box);
  const inside = blocks
    .filter(({ start, count }) => start <= line && line < start + count)
    .pop();
  const target =
    inside ??
    blocks
      .filter(({ start }) => start <= line)
      .reduce<(typeof blocks)[number] | undefined>(
        (best, block) => (!best || block.start >= best.start ? block : best),
        undefined,
      );
  if (!target) return;
  const rect = target.el.getBoundingClientRect();
  let y = rect.top;
  const pre = inside && codeBlock(inside.el);
  if (inside && pre) {
    const { top: first, lineHeight } = codeMetrics(pre);
    y = first + (line - inside.start) * lineHeight;
  } else if (inside) {
    y += ((line - inside.start) / inside.count) * rect.height;
  }
  box.scrollTop += y - box.getBoundingClientRect().top;
};
