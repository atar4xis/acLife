import { describe, expect, it } from "vitest";
import {
  readerTopLine,
  scrollReaderToLine,
} from "../../src/lib/journal/scrollAnchor.ts";

const place = (el: HTMLElement, top: number, height: number) => {
  el.getBoundingClientRect = () =>
    ({ top, bottom: top + height, height, left: 0, right: 0 }) as DOMRect;
  return el;
};

const element = (
  tag: string,
  attributes: Record<string, string>,
  top: number,
  height: number,
  parent?: HTMLElement,
) => {
  const el = document.createElement(tag);
  Object.entries(attributes).forEach(([name, value]) => el.setAttribute(name, value));
  parent?.append(el);
  return place(el, top, height);
};

const note = () => {
  const box = place(document.createElement("div"), 0, 500);
  const first = element("div", { "data-block-start": "1" }, 0, 100, box);
  element("p", { "data-line": "1", "data-end-line": "4" }, 0, 100, first);
  const second = element("div", { "data-block-start": "11" }, 120, 200, box);
  const list = element("ul", { "data-line": "1", "data-end-line": "6" }, 120, 200, second);
  element("li", { "data-line": "1", "data-end-line": "2" }, 120, 100, list);
  element("li", { "data-line": "3", "data-end-line": "6" }, 220, 100, list);
  const code = element("div", { "data-block-start": "20" }, 340, 100, box);
  const pre = element("pre", {}, 340, 100, code);
  pre.style.lineHeight = "20px";
  pre.style.paddingTop = "10px";
  element("code", { "data-line": "2", "data-end-line": "5" }, 350, 80, pre);
  document.body.append(box);
  return box;
};

describe("reader scroll anchor", () => {
  it("adds the block offset and interpolates inside a block", () => {
    const box = note();
    box.getBoundingClientRect = () => ({ top: 25 }) as DOMRect;
    expect(readerTopLine(box)).toBeCloseTo(1 + (25 / 100) * 4);
  });

  it("uses the innermost block that contains the top", () => {
    const box = note();
    box.getBoundingClientRect = () => ({ top: 270 }) as DOMRect;
    expect(readerTopLine(box)).toBeCloseTo(11 + 2 + (50 / 100) * 4);
  });

  it("starts at the next block when the top is in a gap", () => {
    const box = note();
    box.getBoundingClientRect = () => ({ top: 110 }) as DOMRect;
    expect(readerTopLine(box)).toBe(11);
  });

  it("counts whole text lines inside code blocks", () => {
    const box = note();
    box.getBoundingClientRect = () => ({ top: 395 }) as DOMRect;
    expect(readerTopLine(box)).toBeCloseTo(21 + 2.25);
  });

  it("returns the end of the last block when the top is past every block", () => {
    const box = note();
    box.getBoundingClientRect = () => ({ top: 480 }) as DOMRect;
    expect(readerTopLine(box)).toBe(21 + 4);
  });

  it("scrolls to the matching spot inside a block", () => {
    const box = note();
    box.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    scrollReaderToLine(box, 13 + 2);
    expect(box.scrollTop).toBeCloseTo(220 + (2 / 4) * 100);
  });

  it("scrolls code blocks by line height", () => {
    const box = note();
    box.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    scrollReaderToLine(box, 21 + 3);
    expect(box.scrollTop).toBe(350 + 3 * 20);
  });

  it("falls back to the nearest block above, not the footnotes section", () => {
    const box = place(document.createElement("div"), 0, 500);
    const first = element("div", { "data-block-start": "1" }, 0, 50, box);
    element("p", { "data-line": "1", "data-end-line": "1" }, 0, 50, first);
    const second = element("div", { "data-block-start": "10" }, 100, 50, box);
    element("p", { "data-line": "1", "data-end-line": "2" }, 100, 50, second);
    element(
      "section",
      { "data-footnotes": "true", "data-line": "3", "data-end-line": "4" },
      400,
      40,
      box,
    );
    box.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    scrollReaderToLine(box, 15);
    expect(box.scrollTop).toBe(100);
  });

  it("uses the footnotes section as one block and ignores its content", () => {
    const box = note();
    const footnotes = element(
      "section",
      { "data-footnotes": "true", "data-line": "50", "data-end-line": "53" },
      450,
      40,
      box,
    );
    element("p", { "data-line": "1", "data-end-line": "1" }, 460, 30, footnotes);
    box.getBoundingClientRect = () => ({ top: 470 }) as DOMRect;
    expect(readerTopLine(box)).toBeCloseTo(50 + (20 / 40) * 4);
  });
});
