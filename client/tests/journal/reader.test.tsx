import { act, fireEvent, render, screen } from "@testing-library/react";
import Markdown from "react-markdown";
import { describe, expect, it, vi } from "vitest";
import JournalMarkdown from "../../src/components/journal/JournalMarkdown.tsx";
import { openExternal } from "../../src/lib/nativeUpdater.ts";

vi.mock("../../src/lib/nativeUpdater.ts", () => ({ openExternal: vi.fn() }));
vi.mock("react-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-markdown")>();
  return { ...actual, default: vi.fn(actual.default) };
});

const reader = (text: string) =>
  render(<JournalMarkdown>{text}</JournalMarkdown>).container;

describe("journal reading mode", () => {
  it("renders every newline as a line break", () => {
    const html = reader("a\nb\\\nc").querySelector("p")!.innerHTML;
    expect(html.match(/<br>/g)).toHaveLength(2);
  });

  it("keeps the layout of raw html blocks as preformatted text", () => {
    const code = reader("<div>\n  <b>x</b>\n</div>").querySelector(
      "pre code.html-block",
    )!;
    expect(code.textContent).toBe("<div>\n  <b>x</b>\n</div>\n");
  });

  it("adds a link icon and tooltip to links but not to footnote references", () => {
    const container = reader("[web](https://x.test) and a note.[^1]\n\n[^1]: n");
    const [link, ref] = Array.from(container.querySelectorAll("a"));
    expect(link.title).toBe("https://x.test");
    expect(link.querySelector("svg")).toBeTruthy();
    expect(ref.title).toBe("");
    expect(ref.querySelector("svg")).toBeNull();
  });

  it("opens only http links", () => {
    const container = reader("[a](https://x.test) [b](javascript:alert(1))");
    const [good, bad] = Array.from(container.querySelectorAll("a"));
    fireEvent.click(bad);
    expect(openExternal).not.toHaveBeenCalled();
    fireEvent.click(good);
    expect(openExternal).toHaveBeenCalledWith("https://x.test");
  });

  it("resolves reference links across blocks and hides the definitions", () => {
    const container = reader(
      "[ref][r] and [Short]\n\n[r]: https://r.test\n[Short]: https://s.test",
    );
    expect(
      Array.from(container.querySelectorAll("a")).map((a) => a.title),
    ).toEqual(["https://r.test", "https://s.test"]);
    expect(container.textContent).not.toContain("https://r.test");
  });

  it("shows only the alt text for images", () => {
    const container = reader("![alt text](https://x.test/a.png)");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("p")!.textContent).toBe("alt text");
  });

  it("renders read-only task items with the shadcn checkbox", () => {
    const container = reader("- [x] done\n- [ ] todo");
    const boxes = container.querySelectorAll('[role="checkbox"]');
    expect(
      Array.from(boxes).map((box) => box.getAttribute("aria-checked")),
    ).toEqual(["true", "false"]);
    expect(container.querySelectorAll("li.task-list-item")).toHaveLength(2);
    expect(boxes[0].hasAttribute("disabled")).toBe(true);
  });

  it("wraps blocks with their first source line and spacing variants", () => {
    const container = reader("# A\n\n## B\n\n* x\n+ y\n\n---\n\ntext");
    const blocks = Array.from(
      container.querySelectorAll<HTMLElement>(".journal-block"),
    );
    expect(blocks.map((b) => b.dataset.blockStart)).toEqual([
      "1",
      "3",
      "5",
      "6",
      "8",
      "10",
    ]);
    expect(blocks[0].classList.contains("journal-block-tight")).toBe(true);
    expect(blocks[2].classList.contains("journal-block-joined")).toBe(true);
    expect(blocks[4].classList.contains("journal-block-rule")).toBe(true);
  });

  it("tags blocks with their line range, relative to the block", () => {
    const container = reader("a\n\n```js\nx\ny\n```\n\n| A |\n|---|\n| 1 |");
    const code = container.querySelector<HTMLElement>("pre code")!;
    expect([code.dataset.line, code.dataset.endLine]).toEqual(["2", "3"]);
    const table = container.querySelector<HTMLElement>("table")!;
    expect([table.dataset.line, table.dataset.endLine]).toEqual(["1", "3"]);
  });

  it("numbers footnotes by first use and lists them with their ids", () => {
    const container = reader(
      "A.[^second] B.[^1]\n\n[^1]: First\n[^second]: Second **bold**",
    );
    expect(
      Array.from(container.querySelectorAll("sup a")).map((a) => a.textContent),
    ).toEqual(["1", "2"]);
    const section = container.querySelector<HTMLElement>("section[data-footnotes]")!;
    expect(
      Array.from(section.querySelectorAll(".footnote-label")).map(
        (label) => label.textContent,
      ),
    ).toEqual(["second.", "1."]);
    expect(section.querySelector("strong")!.textContent).toBe("bold");
    expect(section.dataset.line).toBe("3");
    expect(section.dataset.endLine).toBe("4");
    expect(container.querySelectorAll("section[data-footnotes]")).toHaveLength(1);
  });

  it("numbers footnotes whose labels contain uppercase letters", () => {
    const container = reader("A.[^Smith2020]\n\n[^Smith2020]: Source");
    expect(
      Array.from(container.querySelectorAll("sup a")).map((a) => a.textContent),
    ).toEqual(["1"]);
  });

  it("numbers footnotes whose labels contain percent signs", () => {
    const container = reader("A.[^100%ab] B.[^é]\n\n[^100%ab]: x\n[^é]: y");
    expect(
      Array.from(container.querySelectorAll("sup a")).map((a) => a.textContent),
    ).toEqual(["1", "2"]);
  });

  it("leaves a reference without a definition as text", () => {
    const container = reader("note[^x]");
    expect(container.querySelector("sup")).toBeNull();
    expect(container.textContent).toBe("note[^x]");
  });

  it("only re-renders the block that changed", async () => {
    const { rerender } = render(
      <JournalMarkdown>{"first\n\nsecond\n\nthird"}</JournalMarkdown>,
    );
    vi.mocked(Markdown).mockClear();

    await act(async () =>
      rerender(<JournalMarkdown>{"first\n\nsecond!\n\nthird"}</JournalMarkdown>),
    );

    expect(vi.mocked(Markdown)).toHaveBeenCalledTimes(1);
    expect(screen.getByText("second!")).toBeTruthy();
  });
});
