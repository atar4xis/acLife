import { describe, expect, it } from "vitest";
import {
  journalParser,
  numberFootnotes,
} from "../../src/lib/journal/markdownParser.ts";

const nodes = (text: string) => {
  const found: string[] = [];
  journalParser.parse(text).iterate({
    enter: (node) => {
      found.push(`${node.name}:${text.slice(node.from, node.to)}`);
    },
  });
  return found;
};

describe("journal markdown parser", () => {
  it("parses single tildes as strikethrough like the reader", () => {
    expect(nodes("H~2~O")).toContain("Strikethrough:~2~");
  });

  it("still parses double tildes and ignores spaced tildes", () => {
    expect(
      nodes("~~a~~").filter((n) => n.startsWith("Strikethrough")),
    ).toEqual(["Strikethrough:~~a~~", "StrikethroughMark:~~", "StrikethroughMark:~~"]);
    expect(nodes("x~~y~~z")).toContain("Strikethrough:~~y~~");
    expect(nodes("~~~a~~~").some((n) => n.startsWith("Strikethrough"))).toBe(
      false,
    );
    expect(nodes("a ~ b ~ c").some((n) => n.startsWith("Strikethrough"))).toBe(
      false,
    );
  });

  it("parses footnote references and definitions with inline content", () => {
    const found = nodes("Hi.[^1]\n\n[^1]: First **b**.");
    expect(found).toContain("FootnoteReference:[^1]");
    expect(found).toContain("FootnoteDefinition:[^1]: First **b**.");
    expect(found).toContain("FootnoteLabel:[^1]:");
    expect(found).toContain("StrongEmphasis:**b**");
  });

  it("ends a footnote definition at the next definition", () => {
    const definitions = nodes("[^a]: Alpha\n[^b]: Beta").filter((n) =>
      n.startsWith("FootnoteDefinition"),
    );
    expect(definitions).toEqual([
      "FootnoteDefinition:[^a]: Alpha",
      "FootnoteDefinition:[^b]: Beta",
    ]);
  });

  it("leaves a normal link reference as a link reference", () => {
    expect(nodes("[a]: https://x.test")).toContain(
      "LinkReference:[a]: https://x.test",
    );
  });

  it("numbers footnotes by first use and skips undefined references", () => {
    const text = "A[^b][^x][^a][^b]\n\n[^a]: A\n[^b]: B";
    const numbers = numberFootnotes(journalParser.parse(text), (from, to) =>
      text.slice(from, to),
    );
    expect([...numbers]).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });

  it("ignores nested footnote definitions", () => {
    const text = "A[^1][^2]\n\n[^1]: top\n> [^2]: nested";
    const numbers = numberFootnotes(journalParser.parse(text), (from, to) =>
      text.slice(from, to),
    );
    expect([...numbers]).toEqual([["1", 1]]);
  });
});
