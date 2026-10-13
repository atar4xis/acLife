import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import JournalEditor from "../../src/components/journal/JournalEditor.tsx";
import { openExternal } from "../../src/lib/nativeUpdater.ts";
import {
  FootnoteLabelWidget,
  FootnoteRefWidget,
} from "../../src/lib/journal/previewWidgets.ts";
import { editorView } from "./helpers.tsx";

vi.mock("../../src/lib/nativeUpdater.ts", () => ({ openExternal: vi.fn() }));

const mount = (text: string, anchor = text.length) => {
  const view = render(
    <JournalEditor label="Editor" placeholder="" value={text} onChange={vi.fn()} />,
  );
  const editor = editorView();
  act(() => editor.dispatch({ selection: { anchor } }));
  return { ...view, editor, content: editor.contentDOM };
};

const cursor = (editor: ReturnType<typeof editorView>, anchor: number) =>
  act(() => editor.dispatch({ selection: { anchor } }));

const styleOf = (el: Element) =>
  (el.getAttribute("style") ?? "").replace(/\s*:\s*/g, ":");

describe("live preview code highlighting", () => {
  const tokens = (content: HTMLElement, name: string) =>
    Array.from(content.querySelectorAll(`.${name}`)).map((el) => el.textContent);

  it("marks tokens of fenced code with a known language", () => {
    const { content } = mount("```js\nconst a = 1;\n```\n\nend");
    expect(tokens(content, "tok-keyword")).toEqual(["const"]);
    expect(tokens(content, "tok-number")).toEqual(["1"]);
  });

  it("keeps tokens aligned inside a blockquote and across lines", () => {
    const { content } = mount("> ```js\n> let a = 'x';\n> let b = 2;\n> ```\n\nend");
    expect(tokens(content, "tok-keyword")).toEqual(["let", "let"]);
    expect(tokens(content, "tok-string")).toEqual(["'x'"]);
    expect(tokens(content, "tok-number")).toEqual(["2"]);
  });

  it("does not mark code without a known language", () => {
    const { content } = mount("```nope\nconst a = 1;\n```\n\nend");
    expect(content.querySelector("[class*=tok-]")).toBeNull();
  });
});

describe("live preview copy button", () => {
  const text = "> ```js\n> let a = 1;\n> let b = 2;\n> ```\n\nend";
  const props = { label: "Editor", placeholder: "", value: text, onChange: vi.fn() };

  it("copies the code of a fenced block and is absent in source mode", async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const view = render(<JournalEditor {...props} />);
    const editor = editorView();
    act(() => editor.dispatch({ selection: { anchor: text.length } }));

    const button = await waitFor(() => {
      const found = editor.contentDOM.querySelector("button[aria-label='Copy code']");
      expect(found).toBeTruthy();
      return found!;
    });
    expect(button.closest(".cm-line")!.classList).toContain("cm-code-first");
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("let a = 1;\nlet b = 2;");

    view.rerender(<JournalEditor {...props} source />);
    expect(editor.contentDOM.querySelector(".cm-copy-code")).toBeNull();
  });
});

describe("live preview source mode", () => {
  const text = "# Title\n\n**bold** and [a](https://x.y)\n\n| a |\n| - |\n| 1 |\n\nend";
  const editorProps = { label: "Editor", placeholder: "", value: text, onChange: vi.fn() };

  it("reveals all markup while keeping the styling, and hides it again", () => {
    const view = render(<JournalEditor {...editorProps} />);
    const editor = editorView();
    act(() => editor.dispatch({ selection: { anchor: text.length } }));
    const { contentDOM: content } = editor;
    expect(content.querySelector(".cm-h1")!.textContent).toBe("Title");
    expect(content.querySelector("table")).toBeTruthy();

    view.rerender(<JournalEditor {...editorProps} source />);
    expect(content.querySelector(".cm-h1")!.textContent).toBe("# Title");
    expect(content.textContent).toContain("**bold**");
    expect(content.textContent).toContain("(https://x.y)");
    expect(content.querySelector("table")).toBeNull();

    view.rerender(<JournalEditor {...editorProps} />);
    expect(content.querySelector(".cm-h1")!.textContent).toBe("Title");
    expect(content.querySelector("table")).toBeTruthy();
  });
});

describe("live preview headings", () => {
  it("styles ATX headings 1 to 6 and hides the marks away from the cursor", () => {
    const text = [1, 2, 3, 4, 5, 6]
      .map((level) => `${"#".repeat(level)} H${level}`)
      .join("\n\n");
    const { content, editor } = mount(`${text}\n\nend`);
    for (let level = 1; level <= 6; level++)
      expect(content.querySelector(`.cm-h${level}`)!.textContent).toBe(`H${level}`);
    cursor(editor, 2);
    expect(content.querySelector(".cm-h1")!.textContent).toBe("# H1");
  });

  it("previews underlined headings and collapses the underline", () => {
    const { content, editor } = mount("Level 1\n=======\n\nLevel 2\n-------\n\nend");
    expect(content.querySelector(".cm-h1")!.textContent).toBe("Level 1");
    expect(content.querySelector(".cm-h2")!.textContent).toBe("Level 2");
    expect(content.querySelectorAll(".cm-collapsed")).toHaveLength(3);
    expect(content.textContent).not.toContain("===");

    cursor(editor, 3);
    expect(content.textContent).toContain("=======");
    expect(content.querySelectorAll(".cm-collapsed")).toHaveLength(1);
  });

  it("spaces directly adjacent headings and collapses blank lines between them", () => {
    const { content, editor } = mount("# A\n## B\n\n### C\n\n\n#### D\n\nend");
    const heads = Array.from(content.querySelectorAll(".cm-h"));
    expect(heads.map((h) => h.classList.contains("cm-h-tight"))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(content.querySelectorAll(".cm-collapsed")).toHaveLength(3);

    cursor(editor, 14);
    expect(content.querySelectorAll(".cm-collapsed")).toHaveLength(0);
  });
});

describe("live preview block spacing", () => {
  const gaps = (text: string) => {
    const { content, unmount } = mount(text);
    const found = Array.from(content.querySelectorAll(".cm-block-gap")).map(
      (line) => line.textContent,
    );
    unmount();
    return found;
  };

  it("adds the reading mode gap between directly adjacent blocks", () => {
    expect(gaps("*keemstar* is cool\n- nobody\n- me\n\nend")).toEqual([
      "keemstar is cool",
    ]);
    expect(gaps("text\n# Head\nmore\n\nend")).toEqual(["text", "Head"]);
  });

  it("leaves joined lists, adjacent headings and blank-separated blocks alone", () => {
    expect(gaps("* a\n+ b\n\nend")).toEqual([]);
    expect(gaps("# A\n## B\n\nend")).toEqual([]);
    expect(gaps("a\n\nb\n\nend")).toEqual([]);
  });

  it("ignores definitions", () => {
    expect(gaps("[a]: https://a.test\n[b]: https://b.test\n\nend")).toEqual([]);
    expect(gaps("# Head\n[a]: https://a.test\n\nend")).toEqual([]);
    expect(gaps("[a]: https://a.test\ntext\n\nend")).toEqual([]);
  });
});

describe("live preview lists", () => {
  it("replaces markers with fixed width widgets by depth", () => {
    const { content } = mount("- a\n  - b\n    - c\n\n1. x\n1. y\n\nend");
    const markers = Array.from(content.querySelectorAll(".cm-list-marker"));
    expect(markers.map((m) => m.textContent)).toEqual(["•", "◦", "▪", "1.", "2."]);
    expect(styleOf(markers[1])).toContain("calc(2 * var(--journal-indent))");
    expect(content.querySelectorAll(".cm-bullet")).toHaveLength(3);
  });

  it("numbers ordered items inside a blockquote", () => {
    const { content } = mount("> 1. one\n> 2. two\n\nend");
    expect(
      Array.from(content.querySelectorAll(".cm-list-marker")).map((m) => m.textContent),
    ).toEqual(["1.", "2."]);
  });

  it("hangs wrapped lines and keeps the raw marker in place while editing", () => {
    const { content, editor } = mount("- a\n  - b\n\nend", 2);
    const lines = Array.from(content.querySelectorAll(".cm-line"));
    expect(styleOf(lines[0])).toContain("padding-inline-start:calc(1 * var(--journal-indent))");
    expect(styleOf(lines[0])).toContain("text-indent:calc(-1 * calc(1 * var(--journal-indent)))");
    expect(styleOf(lines[1])).toContain("calc(2 * var(--journal-indent))");
    expect(lines[0].querySelector(".cm-list-prefix")!.textContent).toBe("-");
    expect(styleOf(lines[0].querySelector(".cm-list-gap")!)).toContain("0.5rem");
    expect(editor.state.doc.toString()).toBe("- a\n  - b\n\nend");
  });

  it("uses a narrower gap after numbers than after bullets", () => {
    const { content } = mount("1. one\n\nend", 2);
    expect(styleOf(content.querySelector(".cm-list-gap")!)).toContain("0.25rem");
  });

  it("indents continuation paragraphs and hides their source spaces", () => {
    const { content, editor } = mount("1. First\n\n   Second paragraph\n\nend");
    const second = Array.from(content.querySelectorAll(".cm-line")).find((l) =>
      l.textContent!.includes("Second"),
    )!;
    expect(second.textContent).toBe("Second paragraph");
    expect(styleOf(second)).toContain("calc(1 * var(--journal-indent))");

    cursor(editor, 14);
    expect(second.textContent).toBe("   Second paragraph");
  });

  it("shows task items as checkboxes that toggle the source", async () => {
    const { content, editor } = mount("- [ ] one\n- [x] two\n\nend");
    const boxes = () =>
      waitFor(() => {
        const found = content.querySelectorAll<HTMLElement>('[role="checkbox"]');
        expect(found).toHaveLength(2);
        return found;
      });
    expect(Array.from(await boxes()).map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true"]);

    fireEvent.click((await boxes())[1]);
    expect(editor.state.doc.toString()).toContain("- [ ] two");
    fireEvent.click((await boxes())[0]);
    expect(editor.state.doc.toString()).toContain("- [x] one");
  });

  it("keeps task widgets when text above changes", async () => {
    const { content, editor } = mount("intro\n\n- [ ] one\n\nend");
    const box = await waitFor(() => {
      const found = content.querySelector('[role="checkbox"]');
      expect(found).toBeTruthy();
      return found!;
    });
    act(() => editor.dispatch({ changes: { from: 0, insert: "more " } }));
    expect(content.querySelector('[role="checkbox"]')).toBe(box);
  });
});

describe("live preview quotes and code", () => {
  it("draws one bar per quote level", () => {
    const { content } = mount("> a\n> > b\n\nend");
    const quotes = content.querySelectorAll<HTMLElement>(".cm-quote");
    expect(quotes[0].style.backgroundImage.match(/linear-gradient/g)).toHaveLength(1);
    expect(quotes[1].style.backgroundImage.match(/linear-gradient/g)).toHaveLength(2);
  });

  it("indents the list inside a quote after the quote bar", () => {
    const { content } = mount("> - item\n\nend");
    expect(styleOf(content.querySelector(".cm-quote")!)).toContain("var(--journal-indent)");
    expect(content.querySelector(".cm-bullet")).toBeTruthy();
  });

  it("collapses fences away from the cursor, also inside quotes and lists", () => {
    const text = "```js\na\n```\n\n> ```js\n> b\n> ```\n\n- item\n\n  ```js\n  c\n  ```\n\nend";
    const { content, editor } = mount(text);
    expect(content.querySelectorAll(".cm-collapsed")).toHaveLength(6);
    expect(content.textContent).not.toContain("```");

    cursor(editor, 8);
    expect(content.querySelectorAll(".cm-collapsed")).toHaveLength(4);
    expect(content.textContent).toContain("```js");
  });

  it("offsets quoted and listed code from the block start", () => {
    const { content } = mount("> ```js\n> b\n> ```\n\n- item\n\n  ```js\n  c\n  ```\n\nend");
    const quoted = content.querySelector(".cm-quote-code")!;
    expect(styleOf(quoted)).toContain("margin-inline-start:var(--quote-offset)");
    const listed = Array.from(content.querySelectorAll(".cm-codeblock")).find((l) =>
      styleOf(l).includes("margin-inline-start:calc(1 * var(--journal-indent))"),
    )!;
    expect(listed.textContent).not.toMatch(/^\s/);
  });

  it("styles indented code and hides its indent", () => {
    const { content } = mount("text\n\n    code\n\n    more\n\nend");
    expect(content.querySelectorAll(".cm-codeblock")).toHaveLength(3);
    expect(content.textContent).not.toContain("    code");
  });

  it("does not choke on blank lines inside a listed code block", () => {
    expect(() => mount("- item\n\n  ```js\n  a\n\n  b\n  ```\n\nend")).not.toThrow();
  });
});

describe("live preview tables", () => {
  const table = "| A | B |\n|:--|--:|\n| **x** | y |";

  it("renders a table like reading mode until the cursor enters it", async () => {
    const { content, editor } = mount(`${table}\n\nend`);
    const cells = await waitFor(() => {
      const found = Array.from(content.querySelectorAll("th, td"));
      expect(found).toHaveLength(4);
      return found;
    });
    expect(cells.map((c) => c.textContent)).toEqual(["A", "B", "x", "y"]);
    expect(content.querySelector("td strong")!.textContent).toBe("x");
    expect((cells[0] as HTMLElement).style.textAlign).toBe("left");
    expect((cells[1] as HTMLElement).style.textAlign).toBe("right");

    cursor(editor, 3);
    expect(content.querySelector("table")).toBeNull();
    expect(content.querySelectorAll(".cm-table-raw")).toHaveLength(3);
  });

  it("renders cell content with the reader, including link icons", async () => {
    const { content } = mount("| A |\n|---|\n| [l](https://x.test) |\n\nend");
    await waitFor(() =>
      expect(content.querySelector("td a svg")).toBeTruthy(),
    );
  });

  it("resolves link references defined outside the table", async () => {
    const { content } = mount("| A |\n|---|\n| [l][r] |\n\n[r]: https://x.test\n\nend");
    await waitFor(() =>
      expect(content.querySelector("td a")?.getAttribute("href")).toBe(
        "https://x.test",
      ),
    );
    expect(content.querySelectorAll("td")).toHaveLength(1);
  });

  it("is not atomic so the cursor can enter it", () => {
    const { editor } = mount(`${table}\n\nend`);
    let covered = false;
    editor.state
      .facet(EditorView.atomicRanges)
      .map((get) => get(editor))
      .forEach((set) =>
        set.between(5, 5, (from, to) => {
          if (5 > from && 5 < to) covered = true;
        }),
      );
    expect(covered).toBe(false);
  });
});

describe("live preview links", () => {
  it("shows the icon and opens a link from it", () => {
    const { content } = mount("see [web](https://x.test) now\n\nend");
    expect(content.querySelector(".cm-link")!.textContent).toBe("web");
    const icon = content.querySelector<HTMLElement>(".cm-link-icon")!;
    expect(icon.title).toBe("https://x.test");
    fireEvent.click(icon);
    expect(openExternal).toHaveBeenCalledWith("https://x.test");
  });

  it("links bare urls and hides the icon while the cursor is inside", () => {
    const { content, editor } = mount("see https://x.test now\n\nend");
    expect(content.querySelector(".cm-link")!.textContent).toBe("https://x.test");
    cursor(editor, 8);
    expect(content.querySelector(".cm-link-icon")).toBeNull();
  });

  it("resolves reference links and keeps the definitions visible", () => {
    const text = "[a][r] [b][] [c] [d]\n\n[r]: https://r.test\n[b]: https://b.test\n[c]: https://c.test";
    const { content } = mount(text);
    expect(
      Array.from(content.querySelectorAll(".cm-link-icon")).map((i) => (i as HTMLElement).title),
    ).toEqual(["https://r.test", "https://b.test", "https://c.test"]);
    expect(content.textContent).toContain("[d]");
    expect(content.querySelectorAll(".cm-link-definition")).toHaveLength(3);
    expect(content.textContent).toContain("[r]: https://r.test");
    expect(content.textContent).not.toContain("[a][r]");
  });

  it("opens a reference link on ctrl click", () => {
    const { editor, content } = mount("[a][r]\n\n[r]: https://r.test");
    vi.spyOn(editor, "posAtCoords").mockReturnValue(1);
    fireEvent.click(content, { ctrlKey: true });
    expect(openExternal).toHaveBeenCalledWith("https://r.test");
  });
});

describe("live preview inline syntax", () => {
  it("hides image syntax and escape backslashes away from the cursor", () => {
    const { content, editor } = mount("![alt](https://x.test/a.png) \\* x\n\nend");
    expect(content.textContent).toContain("alt * x");
    expect(content.textContent).not.toContain("x.test/a.png");
    cursor(editor, 3);
    expect(content.textContent).toContain("\\*");
  });

  it("strikes through single tilde text", () => {
    const { content } = mount("H~2~O\n\nend");
    expect(content.querySelector(".cm-strike")!.textContent).toBe("2");
    expect(content.textContent).toBe("H2Oend");
  });
});

describe("live preview footnotes", () => {
  const text = "A.[^b] B.[^a] C.[^none]\n\n[^a]: Alpha **bold**\n[^b]: Beta";

  it("numbers references by first use and leaves unknown ones as text", () => {
    const { content } = mount(text);
    expect(
      Array.from(content.querySelectorAll(".cm-footnote-ref")).map((r) => r.textContent),
    ).toEqual(["1", "2"]);
    expect(content.textContent).toContain("[^none]");
  });

  it("labels definitions and formats their text", () => {
    const { content, editor } = mount(text, 0);
    expect(
      Array.from(content.querySelectorAll(".cm-footnote-label")).map((l) => l.textContent),
    ).toEqual(["a.", "b."]);
    expect(content.querySelector(".cm-strong")!.textContent).toBe("bold");
    cursor(editor, text.indexOf("[^a]:") + 2);
    expect(content.textContent).toContain("[^a]: Alpha");
  });
});

describe("footnote widgets", () => {
  it("puts the cursor inside the label where it was clicked", () => {
    const text = "A.[^abcd]\n\n[^abcd]: Body";
    const { content, editor } = mount(text, 0);
    const label = content.querySelector<HTMLElement>(".cm-footnote-label")!;
    label.getBoundingClientRect = () => ({ left: 100, width: 50 }) as DOMRect;
    fireEvent.mouseDown(label, { clientX: 125 });
    const start = text.indexOf("[^abcd]:");
    expect(editor.state.selection.main.head).toBe(start + 2 + 2);
  });

  it("let the editor handle clicks so the cursor can enter them", () => {
    expect(new FootnoteLabelWidget("a").ignoreEvent()).toBe(false);
    expect(new FootnoteRefWidget(1).ignoreEvent()).toBe(false);
  });
});

describe("live preview revealed markup", () => {
  const muted = (content: HTMLElement) =>
    Array.from(content.querySelectorAll(".cm-markup")).map((m) => m.textContent);

  it("mutes the characters that are hidden elsewhere", () => {
    const cases: [string, number, string[]][] = [
      ["# Head\n\nend", 2, ["#"]],
      ["**b** end", 3, ["**", "**"]],
      ["*i* end", 1, ["*", "*"]],
      ["~~s~~ end", 3, ["~~", "~~"]],
      ["`c` end", 1, ["`", "`"]],
      ["[l](https://x.test) end", 1, ["[", "]", "(", "https://x.test", ")"]],
      ["![i](u) end", 3, ["![", "]", "(", "u", ")"]],
      ["<https://a.test> end", 3, ["<", ">"]],
      ["\\* end", 1, ["\\"]],
      ["> q\n\nend", 3, [">"]],
      ["- [ ] t\n\nend", 3, ["[ ]"]],
      ["```js\nc\n```\n\nend", 2, ["```", "js", "```"]],
      ["---\n\nend", 1, ["---"]],
      ["Set\n===\n\nend", 1, ["==="]],
      ["a[^1]\n\nend\n\n[^1]: n", 2, ["[^1]"]],
      ["| A |\n|---|\n| 1 |\n\nend", 2, ["|", "|", "|---|", "|", "|"]],
    ];
    for (const [text, anchor, expected] of cases) {
      const { content, unmount } = mount(text, anchor);
      expect(muted(content), text).toEqual(expected);
      unmount();
    }
  });

  it("does not mute brackets that are not a link", () => {
    const { content } = mount("[note] end", 2);
    expect(muted(content)).toEqual([]);
  });
});

describe("live preview external updates", () => {
  it("applies only the changed text and keeps the cursor and widgets", () => {
    const first = "intro\n\n- [ ] one\n\nend";
    const view = render(
      <JournalEditor label="Editor" placeholder="" value={first} onChange={vi.fn()} />,
    );
    const editor = editorView();
    act(() => editor.dispatch({ selection: { anchor: 3 } }));
    const changes: [number, number, string][] = [];
    const update = editor.dispatch.bind(editor);
    vi.spyOn(editor, "dispatch").mockImplementation((...args) => {
      const spec = args[0] as { changes?: { from: number; to: number; insert: string } };
      if (spec.changes) changes.push([spec.changes.from, spec.changes.to, spec.changes.insert]);
      return update(...(args as Parameters<typeof update>));
    });

    view.rerender(
      <JournalEditor label="Editor" placeholder="" value={"intro!\n\n- [ ] one\n\nend"} onChange={vi.fn()} />,
    );

    expect(changes).toEqual([[5, 5, "!"]]);
    expect(editor.state.doc.toString()).toBe("intro!\n\n- [ ] one\n\nend");
    expect(editor.state.selection.main.head).toBe(3);
  });
});
