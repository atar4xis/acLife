import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
  type TransactionSpec,
} from "@codemirror/state";
import type { Command, EditorView, KeyBinding } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6];

const findEnclosing = (
  state: EditorState,
  range: SelectionRange,
  nodeName: string,
) => {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(
      range.from,
      range.empty ? -1 : 1,
    );
    node;
    node = node.parent
  ) {
    if (
      node.name === nodeName &&
      node.from <= range.from &&
      node.to >= range.to
    )
      return node;
  }
  return null;
};

const CODE_BLOCK_NODES = ["FencedCode", "CodeBlock"];

const LITERAL_NODES = ["URL", "InlineCode", ...CODE_BLOCK_NODES];

const dispatchFormat = (view: EditorView, spec: TransactionSpec) => {
  view.dispatch({ ...spec, userEvent: "input.format", scrollIntoView: true });
  return true;
};

const isLiteral = (state: EditorState, range: SelectionRange) =>
  LITERAL_NODES.some((name) => findEnclosing(state, range, name));

const unwrapEnclosing = (
  state: EditorState,
  range: SelectionRange,
  nodeName: string,
) => {
  const node = findEnclosing(state, range, nodeName);
  const opening = node?.firstChild;
  const closing = node?.lastChild;
  if (!opening || !closing || opening === closing) return null;

  const changes = state.changes([
    { from: opening.from, to: opening.to },
    { from: closing.from, to: closing.to },
  ]);
  return {
    changes,
    range: EditorSelection.range(
      changes.mapPos(range.anchor, 1),
      changes.mapPos(range.head, -1),
    ),
  };
};

const toggleWrap =
  (marker: string, nodeName: string): Command =>
  (view) => {
    const { doc } = view.state;
    const length = marker.length;

    const transaction = view.state.changeByRange((range) => {
      const unwrapped = unwrapEnclosing(view.state, range, nodeName);
      if (unwrapped) return unwrapped;

      if (isLiteral(view.state, range)) return { range };

      const { from, to } = range;
      const before = doc.sliceString(Math.max(0, from - length), from);
      const after = doc.sliceString(to, Math.min(doc.length, to + length));

      if (before === marker && after === marker)
        return {
          changes: [
            { from: from - length, to: from },
            { from: to, to: to + length },
          ],
          range: EditorSelection.range(from - length, to - length),
        };

      const text = doc.sliceString(from, to);
      if (
        text.length >= 2 * length &&
        text.startsWith(marker) &&
        text.endsWith(marker)
      )
        return {
          changes: { from, to, insert: text.slice(length, -length) },
          range: EditorSelection.range(from, to - 2 * length),
        };

      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + length, to + length),
      };
    });

    return dispatchFormat(view, transaction);
  };

const insertLink: Command = (view) => {
  const transaction = view.state.changeByRange((range) => {
    const link = findEnclosing(view.state, range, "Link");
    if (link) {
      const marks = link.getChildren("LinkMark");
      const labelStart = marks[0].to;
      const label = view.state.sliceDoc(labelStart, marks[1].from);

      const isInLabel = range.from >= labelStart && range.to <= marks[1].from;
      const shift = link.from - labelStart;

      return {
        changes: { from: link.from, to: link.to, insert: label },
        range: isInLabel
          ? EditorSelection.range(range.anchor + shift, range.head + shift)
          : EditorSelection.range(link.from, link.from + label.length),
      };
    }

    if (isLiteral(view.state, range)) return { range };

    const text = view.state.doc.sliceString(range.from, range.to);
    const insert = `[${text}](url)`;
    const urlStart = range.from + text.length + 3;

    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });

  return dispatchFormat(view, transaction);
};

const BLOCK_MARKER = /^(?:#{1,6} |[-*+] (?:\[[ xX]\] )?|\d+[.)] )/;
const inCodeBlock = (state: EditorState) =>
  state.selection.ranges.some((range) =>
    CODE_BLOCK_NODES.some((name) => findEnclosing(state, range, name)),
  );
const AFTER_QUOTES = /^(?:\s*>)*\s*/;

const toggleLinePrefix =
  (pattern: RegExp, prefix: string, leading = AFTER_QUOTES): Command =>
  (view) => {
    if (inCodeBlock(view.state)) return true;

    const { doc } = view.state;
    const changes: ChangeSpec[] = [];
    let lastLine = 0;

    for (const range of view.state.selection.ranges) {
      const first = doc.lineAt(range.from).number;
      const endsAtLineStart =
        !range.empty && doc.lineAt(range.to).from === range.to;
      const last = doc.lineAt(endsAtLineStart ? range.to - 1 : range.to).number;

      for (
        let number = Math.max(first, lastLine + 1);
        number <= last;
        number++
      ) {
        const line = doc.line(number);
        const indent = line.text.match(leading)![0];
        const existing =
          line.text.slice(indent.length).match(pattern)?.[0] ?? "";
        const normalized = existing
          .replace(/^[*+]/, "-")
          .replace(/^\d+\)/, "1.")
          .replace(/^\d+/, "1")
          .replace(/\[[xX]\]/, "[ ]");

        changes.push({
          from: line.from + indent.length,
          to: line.from + indent.length + existing.length,
          insert: normalized === prefix ? "" : prefix,
        });
      }
      lastLine = Math.max(lastLine, last);
    }

    const changeSet = view.state.changes(changes);
    return dispatchFormat(view, {
      changes: changeSet,
      selection: view.state.selection.map(changeSet, 1),
    });
  };

const toggleHeading = (level: number) =>
  toggleLinePrefix(BLOCK_MARKER, `${"#".repeat(level)} `);

const toggleCodeBlock: Command = (view) => {
  const { doc } = view.state;

  const transaction = view.state.changeByRange((range) => {
    const fenced = findEnclosing(view.state, range, "FencedCode");
    if (fenced) {
      const openingLine = doc.lineAt(fenced.from);
      const hasClosingFence =
        fenced.lastChild?.name === "CodeMark" &&
        fenced.lastChild !== fenced.firstChild;
      const closingLine = doc.lineAt(fenced.to);

      const changes = view.state.changes([
        {
          from: openingLine.from,
          to: Math.min(doc.length, openingLine.to + 1),
        },
        ...(hasClosingFence
          ? [{ from: closingLine.from - 1, to: closingLine.to }]
          : []),
      ]);
      return {
        changes,
        range: EditorSelection.range(
          changes.mapPos(range.anchor, 1),
          changes.mapPos(range.head, -1),
        ),
      };
    }

    const opening = "```\n";
    const startLine = doc.lineAt(range.from);

    return {
      changes: [
        { from: startLine.from, insert: opening },
        { from: doc.lineAt(range.to).to, insert: "\n```" },
      ],
      range: EditorSelection.range(
        range.anchor + opening.length,
        range.head + opening.length,
      ),
    };
  });

  return dispatchFormat(view, transaction);
};

export const formatCommands = {
  bold: toggleWrap("**", "StrongEmphasis"),
  italic: toggleWrap("_", "Emphasis"),
  strikethrough: toggleWrap("~~", "Strikethrough"),
  code: toggleWrap("`", "InlineCode"),
  link: insertLink,
  heading: toggleHeading,
  bulletList: toggleLinePrefix(BLOCK_MARKER, "- "),
  numberedList: toggleLinePrefix(BLOCK_MARKER, "1. "),
  taskList: toggleLinePrefix(BLOCK_MARKER, "- [ ] "),
  quote: toggleLinePrefix(/^> /, "> ", /^\s*/),
  codeBlock: toggleCodeBlock,
};

export const formatKeymap: KeyBinding[] = [
  { key: "Mod-b", run: formatCommands.bold },
  { key: "Mod-i", run: formatCommands.italic },
  { key: "Mod-Shift-x", run: formatCommands.strikethrough },
  { key: "Mod-e", run: formatCommands.code },
  { key: "Mod-k", run: formatCommands.link },
  ...HEADING_LEVELS.map((level) => ({
    key: `Mod-Alt-${level}`,
    run: formatCommands.heading(level),
  })),
];
