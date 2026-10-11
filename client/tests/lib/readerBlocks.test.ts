import { describe, expect, it } from "vitest";
import { splitNote } from "../../src/lib/journal/readerBlocks.ts";

describe("splitNote", () => {
  it("splits top-level blocks with their first source line", () => {
    const { blocks } = splitNote("# Title\n\nParagraph\ncontinued\n\n- a\n- b");
    expect(blocks.map((b) => [b.line, b.source])).toEqual([
      [1, "# Title"],
      [3, "Paragraph\ncontinued"],
      [6, "- a\n- b"],
    ]);
  });

  it("keeps fenced code containing blank lines in one block", () => {
    const { blocks } = splitNote("```\na\n\nb\n```\n\nafter");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].source).toBe("```\na\n\nb\n```");
    expect(blocks[1].line).toBe(7);
  });

  it("marks rules, directly adjacent headings and joined lists", () => {
    const rule = splitNote("a\n\n---\n\nb").blocks.map((b) => b.variant);
    expect(rule).toEqual([undefined, "rule", undefined]);

    const headings = splitNote("# A\n\n## B\n\ntext").blocks.map(
      (b) => b.variant,
    );
    expect(headings).toEqual(["tight", undefined, undefined]);

    const lists = splitNote("* a\n+ b\n\n- c").blocks.map((b) => b.variant);
    expect(lists).toEqual(["joined", undefined, undefined]);
  });

  it("marks blocks that follow each other without a blank line", () => {
    const { blocks } = splitNote("text\n- a\n\nend\n> q\n\n# H\ntext");
    expect(blocks.map((b) => b.variant)).toEqual([
      "adjacent",
      undefined,
      "adjacent",
      undefined,
      "adjacent",
      undefined,
    ]);
  });

  it("appends link reference definitions only to blocks with brackets", () => {
    const { blocks } = splitNote(
      "see [link][r]\n\nplain\n\n[r]: https://r.test",
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0].source).toBe("see [link][r]\n\n[r]: https://r.test");
    expect(blocks[1].source).toBe("plain");
  });

  it("numbers footnotes by first reference and gives blocks dummy definitions", () => {
    const note = splitNote(
      "A[^b]\n\nB[^a][^b]\n\n[^a]: Alpha\n[^b]: Beta\n[^unused]: Unused",
    );
    expect(note.footnotes).toEqual([
      { label: "b", body: "Beta" },
      { label: "a", body: "Alpha" },
    ]);
    expect(note.blocks[0].source).toBe("A[^b]\n\n[^b]: x");
    expect(JSON.parse(note.blocks[0].numbers)).toEqual({ b: 1 });
    expect(JSON.parse(note.blocks[1].numbers)).toEqual({ a: 2, b: 1 });
    expect(note.footnoteLines).toEqual({ start: 5, end: 6 });
  });

  it("numbers only the references that have a definition", () => {
    const note = splitNote("A[^x][^a]\n\n[^a]: Alpha");
    expect(note.footnotes).toEqual([{ label: "a", body: "Alpha" }]);
    expect(JSON.parse(note.blocks[0].numbers)).toEqual({ a: 1 });
  });

  it("ignores references without a definition", () => {
    const note = splitNote("A[^x]");
    expect(note.footnotes).toEqual([]);
    expect(note.blocks[0].source).toBe("A[^x]");
  });

  it("keeps keys of unchanged blocks and distinguishes duplicates", () => {
    const before = splitNote("one\n\ntwo\n\none");
    const after = splitNote("new\n\none\n\ntwo\n\none");
    expect(new Set(before.blocks.map((b) => b.key)).size).toBe(3);
    expect(after.blocks.slice(1).map((b) => b.key)).toEqual([
      before.blocks[0].key,
      before.blocks[1].key,
      before.blocks[2].key,
    ]);
  });

  it("splits an empty note into no blocks", () => {
    expect(splitNote("").blocks).toEqual([]);
  });

  it("does not append definitions to unclosed fences", () => {
    const { blocks } = splitNote(
      "[a]: https://x.test\n\n[^1]: n\n\n```js\narr[0] [^1]",
    );
    expect(blocks.map((b) => b.source)).toEqual(["```js\narr[0] [^1]"]);
  });

  it("keeps the indent of indented code blocks", () => {
    const { blocks } = splitNote("text\n\n    code\n    more");
    expect(blocks.map((b) => [b.line, b.source])).toEqual([
      [1, "text"],
      [3, "    code\n    more"],
    ]);
  });

  it("ignores references inside footnote bodies", () => {
    const { blocks, footnotes } = splitNote("a[^1]\n\n[^1]: see[^2]\n[^2]: more");
    expect(footnotes.map((f) => f.label)).toEqual(["1"]);
    expect(blocks).toHaveLength(1);
  });
});
