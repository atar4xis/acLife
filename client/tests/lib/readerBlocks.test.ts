import { describe, expect, it } from "vitest";
import { Tree } from "@lezer/common";
import {
  chunkBlocks,
  keyBlocks,
  splitNote,
  type KeyedBlocks,
} from "../../src/lib/journal/readerBlocks.ts";

const empty: KeyedBlocks = { blocks: [], next: 0 };
const keyed = (text: string, previous = empty) =>
  keyBlocks(previous, splitNote(text).blocks);
const bullets = (count: number) =>
  Array.from({ length: count }, (_, i) => `- item ${i}`).join("\n");

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

  it("gives every block a distinct key, duplicates included", () => {
    const { blocks } = keyed("one\n\ntwo\n\none");
    expect(new Set(blocks.map((b) => b.key)).size).toBe(3);
  });

  it("keeps the key of a block that was edited in place", () => {
    const before = keyed("one\n\ntwo\n\nthree");
    const after = keyed("one\n\ntwo!\n\nthree", before);
    expect(after.blocks.map((b) => b.key)).toEqual(
      before.blocks.map((b) => b.key),
    );
  });

  it("keeps the keys of unchanged blocks around an inserted one", () => {
    const before = keyed("one\n\ntwo\n\none");
    const after = keyed("new\n\none\n\ntwo\n\none", before);
    const old = before.blocks.map((b) => b.key);
    expect(after.blocks.slice(1).map((b) => b.key)).toEqual(old);
    expect(old).not.toContain(after.blocks[0].key);
  });

  it("never reuses a key for two blocks", () => {
    const before = keyed("a\n\nb");
    const split = keyed("a\n\nb\n\nb\n\nb", before);
    expect(new Set(split.blocks.map((b) => b.key)).size).toBe(4);
    const removed = keyed("b", split);
    expect(new Set(removed.blocks.map((b) => b.key)).size).toBe(1);
  });

  it("splits a long tight list into one block per item", () => {
    const { blocks } = splitNote(`before\n\n${bullets(12)}\n\nafter`);
    const items = blocks.slice(1, 13);
    expect(blocks).toHaveLength(14);
    expect(items.map((b) => b.source)).toEqual(
      Array.from({ length: 12 }, (_, i) => `- item ${i}`),
    );
    expect(items.map((b) => b.line)).toEqual(
      Array.from({ length: 12 }, (_, i) => 3 + i),
    );
    expect(items.slice(0, -1).every((b) => b.variant === "joined")).toBe(true);
    expect(items.at(-1)!.variant).toBeUndefined();
  });

  it("keeps the numbers of a split ordered list", () => {
    const text = Array.from({ length: 11 }, () => "3. same").join("\n");
    const { blocks } = splitNote(text);
    expect(blocks.map((b) => b.source.split(".")[0])).toEqual(
      Array.from({ length: 11 }, (_, i) => String(3 + i)),
    );
  });

  it("keeps nested items inside their parent item", () => {
    const text = `${bullets(10)}\n  - child\n  - child 2`;
    const { blocks } = splitNote(text);
    expect(blocks).toHaveLength(10);
    expect(blocks[9].source).toBe("- item 9\n  - child\n  - child 2");
  });

  it("does not split short, loose or rich lists", () => {
    expect(splitNote(bullets(9)).blocks).toHaveLength(1);
    expect(splitNote(bullets(10).replace("\n- item 5", "\n\n- item 5")).blocks).toHaveLength(1);
    expect(splitNote(bullets(10).replace("- item 5", "- item 5\n  > quote")).blocks).toHaveLength(1);
    expect(splitNote(bullets(10).replace("- item 5", "- item 5\n  ```\n  x\n  ```")).blocks).toHaveLength(1);
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

describe("incremental splitNote", () => {
  const note = [
    "# Title",
    "",
    "Intro with a [ref] and a note.[^1]",
    "",
    "- a",
    "- b",
    "",
    "```js",
    "const x = 1;",
    "```",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "[ref]: https://x.test",
    "",
    "[^1]: Footnote",
    "",
    "end",
  ].join("\n");

  const edits: [string, (text: string) => string][] = [
    ["typing in a paragraph", (t) => t.replace("Intro", "Intro!")],
    ["a new paragraph", (t) => t.replace("end", "end\n\nmore")],
    ["a removed block", (t) => t.replace("# Title\n\n", "")],
    ["closing a fence early", (t) => t.replace("const x = 1;\n```", "```")],
    ["opening a fence", (t) => t.replace("end", "```\nend")],
    ["a new list item", (t) => t.replace("- b", "- b\n- c")],
    ["a changed table", (t) => t.replace("| 1 | 2 |", "| 1 | 2 |\n| 3 | 4 |")],
    ["a removed definition", (t) => t.replace("[ref]: https://x.test\n\n", "")],
    ["a removed footnote", (t) => t.replace("[^1]: Footnote\n\n", "")],
    ["a new footnote", (t) => `${t}\n\n[^2]: Two and a ref[^1]`],
    ["the start of the note", (t) => `> quote\n\n${t}`],
    ["an emptied note", () => ""],
  ];

  it.each(edits)("matches a fresh parse after %s", (_, edit) => {
    const before = splitNote(note);
    const next = edit(note);
    const incremental = splitNote(next, { text: note, tree: before.tree });
    const fresh = splitNote(next);

    expect(incremental.blocks).toEqual(fresh.blocks);
    expect(incremental.footnotes).toEqual(fresh.footnotes);
    expect(incremental.footnoteLines).toEqual(fresh.footnoteLines);
  });

  it("reuses the parsed nodes after the edit", () => {
    const long = Array.from({ length: 200 }, (_, i) => `# H${i}\n\npara ${i}`).join("\n\n");
    const before = splitNote(long);
    const after = splitNote(long.replace("para 3", "para 3!"), {
      text: long,
      tree: before.tree,
    });
    const fresh = splitNote(long.replace("para 3", "para 3!"));

    const parts = (tree: Tree): unknown[] =>
      tree.children.flatMap((child) => [
        child,
        ...(child instanceof Tree ? parts(child) : []),
      ]);
    const old = new Set(parts(before.tree));
    const shared = (note: typeof after) =>
      parts(note.tree).filter((part) => old.has(part)).length;

    expect(shared(after)).toBeGreaterThan(0);
    expect(shared(fresh)).toBe(0);
  });

  it("matches a fresh parse over a chain of edits", () => {
    let text = note;
    let previous = splitNote(text);
    for (const [, edit] of edits.slice(0, 7)) {
      const next = edit(text);
      previous = splitNote(next, { text, tree: previous.tree });
      expect(previous.blocks).toEqual(splitNote(next).blocks);
      text = next;
    }
  });
});

describe("keyBlocks identity", () => {
  it("returns the same block objects when nothing changed", () => {
    const before = keyed("one\n\ntwo");
    const after = keyed("one\n\ntwo", before);
    expect(after.blocks[0]).toBe(before.blocks[0]);
    expect(after.blocks[1]).toBe(before.blocks[1]);
  });

  it("returns a new object when only the line moved", () => {
    const before = keyed("one\n\ntwo");
    const after = keyed("\none\n\ntwo", before);
    expect(after.blocks[0]).not.toBe(before.blocks[0]);
    expect(after.blocks[0].key).toBe(before.blocks[0].key);
  });
});

describe("chunkBlocks", () => {
  const blocks = (count: number) =>
    keyed(Array.from({ length: count }, (_, i) => `p${i}`).join("\n\n")).blocks;

  it("starts a chunk at every block whose key is a multiple of the chunk size", () => {
    const chunks = chunkBlocks(blocks(60));
    expect(chunks.map((c) => c.length)).toEqual([25, 25, 10]);
    expect(chunks.flat()).toHaveLength(60);
  });

  it("keeps the chunk of an unchanged block when blocks are inserted before it", () => {
    const before = keyed(Array.from({ length: 60 }, (_, i) => `p${i}`).join("\n\n"));
    const after = keyed(
      "new\n\n" + Array.from({ length: 60 }, (_, i) => `p${i}`).join("\n\n"),
      before,
    );
    const heads = (state: KeyedBlocks) => chunkBlocks(state.blocks).map((c) => c[0].key);
    expect(heads(after)).toEqual(expect.arrayContaining(heads(before).slice(1)));
  });

  it("returns no chunks for no blocks", () => {
    expect(chunkBlocks([])).toEqual([]);
  });
});
