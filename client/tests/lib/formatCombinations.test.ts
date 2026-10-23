import { syntaxTree } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import {
  EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import type { Command, EditorView } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { expect, test } from "vitest";
import { activeFormats, disabledFormats } from "@/lib/journal/activeFormats";
import { formatCommands, HEADING_LEVELS } from "@/lib/journal/formatKeymap";
import { footnotes, singleTilde } from "@/lib/journal/markdownParser";

const COMMANDS: Record<string, Command> = {
  bold: formatCommands.bold,
  italic: formatCommands.italic,
  strikethrough: formatCommands.strikethrough,
  code: formatCommands.code,
  link: formatCommands.link,
  ...Object.fromEntries(
    HEADING_LEVELS.map((level) => [
      `heading${level}`,
      formatCommands.heading(level),
    ]),
  ),
  bulletList: formatCommands.bulletList,
  numberedList: formatCommands.numberedList,
  taskList: formatCommands.taskList,
  quote: formatCommands.quote,
  codeBlock: formatCommands.codeBlock,
};

const BLOCK_SLOTS = [
  ...HEADING_LEVELS.map((level) => `heading${level}`),
  "bulletList",
  "numberedList",
  "taskList",
];

const SEEDS = [
  "x",
  "- x",
  "> 1. x",
  "# x",
  "**x**",
  "[x](u)",
  "`x`",
  "```\nx\n```",
  "- [ ] x",
];

const SEED_DEPTH = 4;
const INVOLUTION_DEPTH = 2;
const TOGGLES = [
  "bold",
  "italic",
  "strikethrough",
  "code",
  "link",
  "quote",
  "codeBlock",
];

const create = (doc: string) =>
  EditorState.create({
    doc,
    selection: { anchor: doc.indexOf("x"), head: doc.indexOf("x") + 1 },
    extensions: [markdown({ extensions: [GFM, singleTilde, footnotes] })],
  });

const run = (state: EditorState, name: string) => {
  const fake = {
    state,
    dispatch: (...specs: TransactionSpec[]) => {
      fake.state = fake.state.update(...specs).state;
    },
  };
  COMMANDS[name](fake as unknown as EditorView);
  return fake.state;
};

const formatsOf = (state: EditorState) =>
  new Set(activeFormats(state).filter((format) => format !== "url"));

const isInUrl = (state: EditorState) => {
  const { from } = state.selection.main;
  for (
    let node = syntaxTree(state).resolveInner(from, 1);
    node;
    node = node.parent!
  ) {
    if (node.name === "URL") return true;
    if (!node.parent) return false;
  }
  return false;
};

const expectedFormats = (
  name: string,
  before: Set<string>,
  inUrl: boolean,
  unfenced: Set<string>,
) => {
  const after = new Set(before);
  const toggle = (format: string) =>
    after.has(format) ? after.delete(format) : after.add(format);

  if (name === "codeBlock")
    return before.has("codeBlock") ? unfenced : new Set(["codeBlock"]);
  if (before.has("codeBlock")) return before;

  if (["bold", "italic", "strikethrough"].includes(name)) {
    if (before.has(name) || (!before.has("code") && !inUrl)) toggle(name);
    return after;
  }

  if (name === "code") {
    if (before.has("code") || !inUrl) toggle("code");
    return after;
  }

  if (name === "link") {
    if (before.has("link") || !before.has("code")) toggle("link");
    return after;
  }

  if (name === "quote") {
    toggle("quote");
    return after;
  }

  const wasActive = before.has(name);
  BLOCK_SLOTS.forEach((slot) => after.delete(slot));
  if (!wasActive) after.add(name);
  return after;
};

const sorted = (formats: Set<string>) => [...formats].sort().join(",");

test("every sequence of format commands keeps nesting and highlights correct", () => {
  const failures: string[] = [];

  const walk = (
    state: EditorState,
    path: string[],
    depth: number,
    unfenced: Set<string>,
  ) => {
    const before = formatsOf(state);
    const inUrl = isInUrl(state);

    for (const name of Object.keys(COMMANDS)) {
      if (failures.length >= 10) return;

      const next = run(state, name);
      const expected = expectedFormats(name, before, inUrl, unfenced);
      const actual = formatsOf(next);
      const doc = next.doc.toString();
      const step = [...path, name];
      const disabled = disabledFormats([...before, ...(inUrl ? ["url"] : [])]);
      const isNoop = next.doc.eq(state.doc);

      if (
        sorted(actual) !== sorted(expected) ||
        doc.split("x").length !== 2 ||
        isNoop !== disabled.includes(name)
      ) {
        failures.push(
          `${step.join(" > ")}: ${JSON.stringify(doc)} expected [${sorted(expected)}] got [${sorted(actual)}]`,
        );
        continue;
      }

      if (depth + 1 < SEED_DEPTH)
        walk(
          next,
          step,
          depth + 1,
          name === "codeBlock" && !before.has("codeBlock") ? before : unfenced,
        );
    }
  };

  for (const seed of SEEDS) {
    const state = create(seed);
    const seedFormats = formatsOf(state);
    walk(state, [JSON.stringify(seed)], 0, seedFormats.has("codeBlock") ? new Set() : seedFormats);
  }

  expect(failures).toEqual([]);
}, 120_000);

test("applying a toggle twice restores the formatting", () => {
  const failures: string[] = [];

  const walk = (state: EditorState, path: string[], depth: number) => {
    const before = formatsOf(state);
    const inUrl = isInUrl(state);
    const cannotReapply: Record<string, boolean> = {
      bold: before.has("code") || inUrl,
      italic: before.has("code") || inUrl,
      strikethrough: before.has("code") || inUrl,
      code: inUrl,
      link: before.has("code"),
    };

    for (const toggle of TOGGLES) {
      if (before.has(toggle) && cannotReapply[toggle]) continue;

      const twice = run(run(state, toggle), toggle);
      const isRestored =
        sorted(formatsOf(twice)) === sorted(before) &&
        (!["quote", "codeBlock"].includes(toggle) ||
          twice.doc.toString() === state.doc.toString());

      if (!isRestored)
        failures.push(
          `${[...path, toggle, toggle].join(" > ")}: ${JSON.stringify(state.doc.toString())} became ${JSON.stringify(twice.doc.toString())}`,
        );
    }

    if (depth + 1 > INVOLUTION_DEPTH || failures.length >= 10) return;
    for (const name of Object.keys(COMMANDS))
      walk(run(state, name), [...path, name], depth + 1);
  };

  for (const seed of SEEDS) walk(create(seed), [JSON.stringify(seed)], 0);

  expect(failures).toEqual([]);
}, 120_000);
