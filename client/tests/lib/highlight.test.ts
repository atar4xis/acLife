import { describe, expect, it } from "vitest";
import { highlightLines } from "../../src/lib/journal/highlight.ts";

describe("highlightLines", () => {
  it("keeps the text of every line, one entry per newline", () => {
    const lines = highlightLines("const a = 1;\n\nlet b", "js");
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.segments.map((s) => s.text).join(""))).toEqual([
      "const a = 1;",
      "",
      "let b",
    ]);
  });

  it("splits a token that spans lines and keeps its class on each part", () => {
    const [first, second] = highlightLines("/* a\nb */", "js");
    expect(first.segments).toEqual([
      { text: "/* a", className: "tok-comment" },
    ]);
    expect(second.segments).toEqual([{ text: "b */", className: "tok-comment" }]);
  });

  it("gives equal lines equal signatures and different lines different ones", () => {
    const [a, b, c] = highlightLines("let x\nlet x\nlet y", "js");
    expect(a.signature).toBe(b.signature);
    expect(a.signature).not.toBe(c.signature);
  });

  it("tells apart text from its token class", () => {
    const [plain] = highlightLines("let", "nope");
    const [token] = highlightLines("let", "js");
    expect(plain.signature).not.toBe(token.signature);
  });

  it("returns a single empty line for empty code", () => {
    expect(highlightLines("", "js")).toEqual([{ segments: [], signature: "" }]);
  });
});
