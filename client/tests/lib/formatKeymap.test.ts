import { markdown } from "@codemirror/lang-markdown";
import {
  EditorState,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { expect, test } from "vitest";
import { activeFormats } from "@/lib/journal/activeFormats";
import { formatCommands } from "@/lib/journal/formatKeymap";
import { footnotes, singleTilde } from "@/lib/journal/markdownParser";

const makeView = (doc: string, anchor: number, head = anchor) =>
  new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [markdown({ extensions: [GFM, singleTilde, footnotes] })],
    }),
  });

test("repeating a mark on nested formatting removes the outer layer", () => {
  const view = makeView("x", 0, 1);
  formatCommands.bold(view);
  formatCommands.italic(view);
  formatCommands.strikethrough(view);
  expect(view.state.doc.toString()).toBe("**_~~x~~_**");

  formatCommands.bold(view);
  expect(view.state.doc.toString()).toBe("_~~x~~_");
  expect(view.state.sliceDoc(...[view.state.selection.main.from, view.state.selection.main.to])).toBe("x");
});

test("a cursor inside a mark removes it", () => {
  const view = makeView("**ab**", 3);
  formatCommands.bold(view);
  expect(view.state.doc.toString()).toBe("ab");
  expect(view.state.selection.main.head).toBe(1);
});

test("plain text gets wrapped", () => {
  const view = makeView("ab", 0, 2);
  formatCommands.bold(view);
  expect(view.state.doc.toString()).toBe("**ab**");
});

test("inline marks do nothing inside a link url", () => {
  const view = makeView("[a](url)", 4, 7);
  formatCommands.bold(view);
  formatCommands.code(view);
  expect(view.state.doc.toString()).toBe("[a](url)");
});

test("link toggles off back to its label", () => {
  const view = makeView("x", 0, 1);
  formatCommands.link(view);
  expect(view.state.doc.toString()).toBe("[x](url)");

  formatCommands.link(view);
  expect(view.state.doc.toString()).toBe("x");
});

test("link and marks do nothing inside inline code or a code block", () => {
  const inline = makeView("`ab`", 2);
  formatCommands.link(inline);
  formatCommands.bold(inline);
  expect(inline.state.doc.toString()).toBe("`ab`");

  const fenced = makeView("```\nab\n```", 5);
  formatCommands.link(fenced);
  formatCommands.code(fenced);
  expect(fenced.state.doc.toString()).toBe("```\nab\n```");
});

test("code toggles off inside inline code", () => {
  const view = makeView("`ab`", 2);
  formatCommands.code(view);
  expect(view.state.doc.toString()).toBe("ab");
});

test("list types replace each other instead of stacking", () => {
  const view = makeView("x", 0);
  formatCommands.bulletList(view);
  expect(view.state.doc.toString()).toBe("- x");
  formatCommands.numberedList(view);
  expect(view.state.doc.toString()).toBe("1. x");
  formatCommands.taskList(view);
  expect(view.state.doc.toString()).toBe("- [ ] x");
  formatCommands.bulletList(view);
  expect(view.state.doc.toString()).toBe("- x");
  formatCommands.bulletList(view);
  expect(view.state.doc.toString()).toBe("x");
});

test("list switching keeps nesting indentation", () => {
  const view = makeView("- a\n  - b", 8);
  formatCommands.numberedList(view);
  expect(view.state.doc.toString()).toBe("- a\n  1. b");
  formatCommands.taskList(view);
  expect(view.state.doc.toString()).toBe("- a\n  - [ ] b");
  formatCommands.taskList(view);
  expect(view.state.doc.toString()).toBe("- a\n  b");
});

test("quote and lists nest without stacking markers", () => {
  const view = makeView("x", 0);
  formatCommands.bulletList(view);
  formatCommands.quote(view);
  expect(view.state.doc.toString()).toBe("> - x");

  formatCommands.numberedList(view);
  expect(view.state.doc.toString()).toBe("> 1. x");

  formatCommands.numberedList(view);
  expect(view.state.doc.toString()).toBe("> x");

  formatCommands.quote(view);
  expect(view.state.doc.toString()).toBe("x");
});

test("heading goes after quote markers", () => {
  const view = makeView("> x", 3);
  formatCommands.heading(2)(view);
  expect(view.state.doc.toString()).toBe("> ## x");
});

test("a selection ending at the start of a line leaves that line alone", () => {
  const view = makeView("a\nb\nc", 0, 4);
  formatCommands.bulletList(view);
  expect(view.state.doc.toString()).toBe("- a\n- b\nc");
});

test("a selection reaching into a line still formats it", () => {
  const view = makeView("a\nb\nc", 0, 5);
  formatCommands.quote(view);
  expect(view.state.doc.toString()).toBe("> a\n> b\n> c");
});

test("the url format is reported only inside a link url", () => {
  expect(activeFormats(makeView("[a](url)", 6).state)).toContain("url");
  expect(activeFormats(makeView("[a](url)", 2).state)).not.toContain("url");
});

test("line prefixes put a cursor at the line start after the prefix", () => {
  const view = makeView("ab", 0);
  formatCommands.bulletList(view);
  expect(view.state.selection.main.head).toBe(2);
});

test("line prefixes do nothing inside an indented code block", () => {
  const view = makeView("para\n\n    ab", 11);
  formatCommands.bulletList(view);
  formatCommands.quote(view);
  formatCommands.heading(1)(view);
  expect(view.state.doc.toString()).toBe("para\n\n    ab");
});

test("format changes are tagged as format input and scrolled into view", () => {
  const view = makeView("x", 0, 1);
  const transactions: Transaction[] = [];
  const dispatch = view.dispatch.bind(view);
  view.dispatch = ((...specs: TransactionSpec[]) => {
    transactions.push(view.state.update(...specs));
    dispatch(...specs);
  }) as typeof view.dispatch;

  formatCommands.bold(view);
  formatCommands.bulletList(view);
  formatCommands.link(view);
  formatCommands.codeBlock(view);

  expect(transactions).toHaveLength(4);
  for (const transaction of transactions) {
    expect(transaction.isUserEvent("input.format")).toBe(true);
    expect(transaction.scrollIntoView).toBe(true);
  }
});
