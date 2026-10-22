import { syntaxTree } from "@codemirror/language";
import {
  type EditorState,
  Facet,
  type Range,
  Prec,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  keymap,
} from "@codemirror/view";
import { highlightCode } from "@/lib/journal/highlight";
import {
  FOOTNOTE_REFERENCE,
  isDefinition,
  isHeading,
  isList,
  numberFootnotes,
} from "@/lib/journal/markdownParser";
import {
  BULLET_GAP,
  BULLETS,
  CheckboxWidget,
  CopyCodeWidget,
  FootnoteLabelWidget,
  FootnoteRefWidget,
  LinkIconWidget,
  ListMarkerWidget,
  NUMBER_GAP,
  RuleWidget,
  TableWidget,
} from "@/lib/journal/previewWidgets";
import { cn, isModKey } from "@/lib/utils";
import { openExternal } from "@/lib/nativeUpdater";
import { isValidUrl } from "@/lib/validators";

const hide = Decoration.replace({});

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

const line = (name: string) => Decoration.line({ class: name });
const mark = (name: string) => Decoration.mark({ class: name });
const markup = mark("cm-markup");

// tokenizes the whole fence at once, then maps segments back onto its `CodeText` lines
const highlightFence = (
  state: EditorState,
  fence: SyntaxNode,
  from: number,
  to: number,
) => {
  const info = fence.getChild("CodeInfo");
  const pieces = fence.getChildren("CodeText");
  if (!info || !pieces.length) return [];
  const language = state.sliceDoc(info.from, info.to).trim().split(/\s/)[0];
  const code = pieces.map((p) => state.sliceDoc(p.from, p.to)).join("\n");

  // offset of each piece within `code` (pieces are joined by one newline)
  let total = 0;
  const starts = pieces.map((p) => {
    const start = total;
    total += p.to - p.from + 1;
    return start;
  });

  const out: Range<Decoration>[] = [];
  let offset = 0;
  let first = 0;
  for (const { text, className } of highlightCode(code, language)) {
    const end = offset + text.length;

    // skip pieces entirely before this segment so the scan stays linear
    while (first < pieces.length - 1 && starts[first + 1] <= offset) first++;

    // a segment can span several pieces (multi-line comments or strings)
    for (
      let i = first;
      className && i < pieces.length && starts[i] < end;
      i++
    ) {
      const a = Math.max(offset, starts[i]);
      const b = Math.min(end, starts[i] + pieces[i].to - pieces[i].from);
      const shift = pieces[i].from - starts[i];
      const [x, y] = [Math.max(a + shift, from), Math.min(b + shift, to)];
      if (x < y) out.push(mark(className).range(x, y));
    }
    offset = end;
  }

  return out;
};

const MARKED: Record<string, string> = {
  StrongEmphasis: "cm-strong",
  Emphasis: "cm-em",
  Strikethrough: "cm-strike",
  InlineCode: "cm-code",
};

const MARKUP = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "LinkMark",
  "LinkLabel",
  "URL",
  "LinkTitle",
]);

const MARKUP_PARENTS = new Set([
  "StrongEmphasis",
  "Emphasis",
  "Strikethrough",
  "InlineCode",
  "Link",
  "Image",
]);

const countAncestors = (node: SyntaxNode, names: string[]) => {
  let count = 0;
  for (let p = node.parent; p; p = p.parent)
    if (names.includes(p.name)) count++;
  return count;
};

const LISTS = ["BulletList", "OrderedList"];
const listDepth = (item: SyntaxNode) => countAncestors(item, LISTS);
const bulletDepth = (item: SyntaxNode) => countAncestors(item, ["BulletList"]);
const inBlockquote = (node: SyntaxNode) =>
  countAncestors(node, ["Blockquote"]) > 0;

const quoteStyle = (depth: number, listDepth = 0, code = false) => {
  const step = "(var(--journal-quote-bar) + var(--journal-quote-pad))";
  if (code)
    return `--quote-offset:calc(${depth} * ${step});margin-inline-start:var(--quote-offset);position:relative`;
  const indent = `${listDepth} * var(--journal-indent)`;
  const bars = Array.from({ length: depth }, (_, i) => i);
  const css = (value: (i: number) => string) => bars.map(value).join(",");
  return [
    `padding-inline-start:calc(${depth} * ${step} + ${indent})`,
    `text-indent:calc(-1 * ${indent})`,
    `background-image:${css(() => "linear-gradient(var(--border),var(--border))")}`,
    `background-repeat:no-repeat`,
    `background-size:${css(() => "var(--journal-quote-bar) 100%")}`,
    `background-position:${css((i) => `calc(${i} * ${step}) 0`)}`,
  ].join(";");
};

const normalizeLabel = (label: string) =>
  label.trim().replace(/\s+/g, " ").toLowerCase();

const linkDefinitions = (state: EditorState) => {
  const defs = new Map<string, string>();
  for (let n = syntaxTree(state).topNode.firstChild; n; n = n.nextSibling) {
    const label = n.name === "LinkReference" && n.getChild("LinkLabel");
    const url = label && n.getChild("URL");
    if (label && url)
      defs.set(
        normalizeLabel(state.sliceDoc(label.from + 1, label.to - 1)),
        state.sliceDoc(url.from, url.to),
      );
  }
  return defs;
};

const linkHref = (
  state: EditorState,
  link: SyntaxNode,
  defs: Map<string, string>,
) => {
  const url = link.getChild("URL");
  if (url) return state.sliceDoc(url.from, url.to);
  const label = link.getChild("LinkLabel");
  const [open, close] = link.getChildren("LinkMark");
  const key =
    label && label.to - label.from > 2
      ? state.sliceDoc(label.from + 1, label.to - 1)
      : state.sliceDoc(open.to, close.from);
  return defs.get(normalizeLabel(key)) ?? null;
};

const linkIcon = (href: string, at: number) =>
  Decoration.widget({ widget: new LinkIconWidget(href), side: 1 }).range(at);

const orderedNumber = (state: EditorState, item: SyntaxNode) => {
  const first = item.parent!.firstChild!.getChild("ListMark")!;
  let index = 0;
  for (let p = item.prevSibling; p; p = p.prevSibling)
    if (p.name === "ListItem") index++;
  return parseInt(state.sliceDoc(first.from, first.to), 10) + index;
};

export const sourceMode = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

const build = (
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
) => {
  const out: Range<Decoration>[] = [];
  const selection = state.selection.ranges;
  const source = state.facet(sourceMode);
  const touches = (from: number, to: number) =>
    source || selection.some((r) => r.from <= to && r.to >= from);
  const lineTouches = (from: number, to: number) =>
    touches(state.doc.lineAt(from).from, state.doc.lineAt(to).to);
  const withSpace = (to: number) =>
    state.sliceDoc(to, to + 1) === " " ? to + 1 : to;
  const quoted = new Map<number, number>();
  const defs = linkDefinitions(state);
  let footnoteNumbers: Map<string, number> | undefined;
  const footnoteNumber = (label: string) => {
    footnoteNumbers ??= numberFootnotes(syntaxTree(state), (from, to) =>
      state.sliceDoc(from, to),
    );
    return footnoteNumbers.get(label);
  };
  const quotedLists = new Map<number, number>();
  const quotedCode = new Set<number>();
  const itemStart = (markFrom: number) => {
    const lineFrom = state.doc.lineAt(markFrom).from;
    const prefix = state.sliceDoc(lineFrom, markFrom);
    if (!/^[\s>]*$/.test(prefix)) return null;
    const quote = prefix.lastIndexOf(">");
    if (quote === -1) return lineFrom;
    return lineFrom + quote + (prefix[quote + 1] === " " ? 2 : 1);
  };

  for (const { from, to } of ranges) {
    const eachLine = (
      nodeFrom: number,
      nodeTo: number,
      fn: (start: number, i: number, last: boolean) => void,
    ) => {
      const first = state.doc.lineAt(nodeFrom).number;
      const last = state.doc.lineAt(nodeTo).number;
      const visibleFirst = Math.max(first, state.doc.lineAt(from).number);
      const visibleLast = Math.min(last, state.doc.lineAt(to).number);
      for (let n = visibleFirst; n <= visibleLast; n++)
        fn(state.doc.line(n).from, n - first, n === last);
    };

    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const { name } = node;
        const parent = node.node.parent;

        if (parent?.name === "Document" && !isDefinition(name)) {
          const next = node.node.nextSibling;
          if (
            next &&
            !isDefinition(next.name) &&
            !(isHeading(name) && isHeading(next.name)) &&
            !(isList(name) && isList(next.name)) &&
            state.doc.lineAt(next.from).number ===
              state.doc.lineAt(node.to).number + 1
          )
            out.push(
              line("cm-block-gap").range(state.doc.lineAt(node.to).from),
            );
        }

        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (heading) {
          const underline = node.node.getChild("HeaderMark");
          const setext = name.startsWith("Setext");
          const rule = setext ? state.doc.lineAt(underline!.from) : null;
          const raw = touches(node.from, node.to);
          eachLine(node.from, node.to, (start) => {
            if (start !== rule?.from)
              out.push(line(`cm-h cm-h${heading[1]}`).range(start));
            else if (!raw) {
              out.push(line("cm-collapsed").range(start));
              out.push(hide.range(rule.from, rule.to));
            } else if (rule.to > rule.from) {
              out.push(markup.range(rule.from, rule.to));
            }
          });

          const next = node.node.nextSibling;
          if (next && isHeading(next.name)) {
            const last = state.doc.lineAt(node.to);
            const nextLine = state.doc.lineAt(next.from);
            out.push(line("cm-h-tight").range(last.from));
            if (!touches(node.from, next.to))
              for (let n = last.number + 1; n < nextLine.number; n++)
                out.push(line("cm-collapsed").range(state.doc.line(n).from));
          }
        } else if (name === "HeaderMark" && parent?.name.startsWith("ATX")) {
          if (!lineTouches(node.from, node.to))
            out.push(hide.range(node.from, withSpace(node.to)));
          else out.push(markup.range(node.from, node.to));
        } else if (name === "Blockquote") {
          eachLine(node.from, node.to, (start) =>
            quoted.set(start, (quoted.get(start) ?? 0) + 1),
          );
        } else if (name === "QuoteMark") {
          if (!lineTouches(node.from, node.to))
            out.push(hide.range(node.from, withSpace(node.to)));
          else out.push(markup.range(node.from, node.to));
        } else if (name === "FencedCode") {
          const raw = touches(node.from, node.to);
          const quote = inBlockquote(node.node);
          const lists = quote ? 0 : listDepth(node.node);
          const column = node.from - state.doc.lineAt(node.from).from;
          out.push(...highlightFence(state, node.node, from, to));
          eachLine(node.from, node.to, (start, i, last) => {
            if (quote) quotedCode.add(start);
            if (!source && i === 0)
              out.push(
                Decoration.widget({
                  widget: new CopyCodeWidget(
                    node.node
                      .getChildren("CodeText")
                      .map((p) =>
                        state.sliceDoc(p.from, p.to).replace(/\n$/, ""),
                      )
                      .join("\n"),
                  ),
                  side: 1,
                }).range(start),
              );
            if (lists > 0 && !raw) {
              out.push(
                Decoration.line({
                  attributes: {
                    style: `margin-inline-start:calc(${lists} * var(--journal-indent))`,
                  },
                }).range(start),
              );
              const lead = state.doc.lineAt(start).text.slice(0, column);
              if (lead.length === column && /^\s+$/.test(lead))
                out.push(hide.range(start, start + column));
            }
            const fence =
              (i === 0 || last) &&
              /^[\s>]*(```|~~~)/.test(state.doc.lineAt(start).text);
            out.push(
              line(
                cn(
                  "cm-codeblock",
                  i === 0 && "cm-codefence cm-code-first",
                  last && "cm-codefence cm-code-last",
                  fence && !raw && "cm-collapsed",
                ),
              ).range(start),
            );
          });
        } else if (name === "CodeBlock") {
          const raw = touches(node.from, node.to);
          const quote = inBlockquote(node.node);
          eachLine(node.from, node.to, (start, i, last) => {
            if (quote) quotedCode.add(start);
            out.push(
              line(
                cn(
                  "cm-codeblock",
                  i === 0 && "cm-code-first",
                  last && "cm-code-last",
                ),
              ).range(start),
            );
            const indent = /^( {4}|\t)/.exec(state.sliceDoc(start, start + 4));
            if (indent && !raw)
              out.push(hide.range(start, start + indent[0].length));
          });
        } else if (name === "Paragraph" && parent?.name === "ListItem") {
          const firstLine = state.doc.lineAt(node.from);
          const column = node.from - firstLine.from;
          const raw = touches(node.from, node.to);
          const indent = `calc(${listDepth(parent)} * var(--journal-indent))`;
          if (/^\s*$/.test(state.sliceDoc(firstLine.from, node.from)))
            eachLine(node.from, node.to, (start) => {
              if (start === state.doc.lineAt(parent.from).from) return;
              const text = state.doc.lineAt(start).text;
              const lead = Math.min(/^\s*/.exec(text)![0].length, column);
              out.push(
                Decoration.line({
                  attributes: {
                    style: `padding-inline-start:${indent}${raw && lead > 0 ? `;text-indent:calc(-1 * ${indent})` : ""}`,
                  },
                }).range(start),
              );
              if (lead === 0) return;
              if (raw)
                out.push(
                  Decoration.mark({
                    class: "cm-list-prefix",
                    attributes: { style: `min-width:${indent}` },
                  }).range(start, start + lead),
                );
              else out.push(hide.range(start, start + lead));
            });
        } else if (name === "Table") {
          if (touches(node.from, node.to))
            eachLine(node.from, node.to, (start) =>
              out.push(line("cm-table-raw").range(start)),
            );
        } else if (name === "Escape") {
          if (!lineTouches(node.from, node.to))
            out.push(hide.range(node.from, node.from + 1));
          else out.push(markup.range(node.from, node.from + 1));
        } else if (name === "CodeMark" && parent?.name === "FencedCode") {
          if (!touches(parent.from, parent.to))
            out.push(hide.range(node.from, node.to));
          else out.push(markup.range(node.from, node.to));
        } else if (name === "CodeInfo") {
          if (!touches(parent!.from, parent!.to))
            out.push(hide.range(node.from, node.to));
          else out.push(markup.range(node.from, node.to));
        } else if (name === "HorizontalRule") {
          if (!lineTouches(node.from, node.to))
            out.push(
              Decoration.replace({ widget: new RuleWidget() }).range(
                node.from,
                node.to,
              ),
            );
          else out.push(markup.range(node.from, node.to));
        } else if (name === "TaskMarker") {
          const item = parent!.parent!;
          const checked = state.sliceDoc(node.from, node.to) !== "[ ]";
          if (checked && withSpace(node.to) < parent!.to)
            out.push(
              Decoration.mark({ class: "cm-task-done" }).range(
                withSpace(node.to),
                parent!.to,
              ),
            );
          if (
            itemStart(item.from) !== null &&
            !lineTouches(node.from, node.to)
          ) {
            out.push(
              Decoration.replace({
                widget: new CheckboxWidget(checked, listDepth(item)),
              }).range(node.from, withSpace(node.to)),
            );
          } else if (lineTouches(node.from, node.to)) {
            out.push(markup.range(node.from, node.to));
          }
        } else if (name === "ListMark") {
          const item = parent!;
          const lineFrom = state.doc.lineAt(node.from).from;
          const start = itemStart(node.from);
          if (start !== null) {
            const depth = listDepth(item);
            const indent = `calc(${depth} * var(--journal-indent))`;
            if (quoted.has(lineFrom)) quotedLists.set(lineFrom, depth);
            else
              out.push(
                Decoration.line({
                  attributes: {
                    style: `padding-inline-start:${indent};text-indent:calc(-1 * ${indent})`,
                  },
                }).range(lineFrom),
              );
            const end = withSpace(node.to);
            const gap =
              item.parent?.name === "BulletList" ? BULLET_GAP : NUMBER_GAP;
            if (lineTouches(node.from, node.to)) {
              out.push(
                Decoration.mark({
                  class: "cm-list-prefix",
                  attributes: {
                    style: `min-width:calc(${indent} - ${gap})`,
                  },
                }).range(start, node.to),
              );
              if (end > node.to)
                out.push(
                  Decoration.mark({
                    class: "cm-list-gap",
                    attributes: { style: `width:${gap}` },
                  }).range(node.to, end),
                );
            } else if (item.getChild("Task")) {
              out.push(hide.range(start, end));
            } else {
              const bullet = item.parent?.name === "BulletList";
              out.push(
                Decoration.replace({
                  widget: new ListMarkerWidget(
                    bullet
                      ? BULLETS[Math.min(bulletDepth(item), BULLETS.length) - 1]
                      : `${orderedNumber(state, item)}.`,
                    depth,
                    bullet,
                  ),
                }).range(start, end),
              );
            }
          }
        } else if (name === "Link") {
          const href = linkHref(state, node.node, defs);
          if (href !== null) {
            out.push(mark("cm-link").range(node.from, node.to));
            if (!touches(node.from, node.to)) out.push(linkIcon(href, node.to));
          }
        } else if (
          name === "URL" &&
          parent &&
          parent.name !== "LinkReference" &&
          !MARKUP_PARENTS.has(parent.name)
        ) {
          out.push(mark("cm-link").range(node.from, node.to));
          if (!touches(node.from, node.to))
            out.push(linkIcon(state.sliceDoc(node.from, node.to), node.to));
        } else if (name === "LinkMark" && parent?.name === "Autolink") {
          if (!touches(parent.from, parent.to))
            out.push(hide.range(node.from, node.to));
          else out.push(markup.range(node.from, node.to));
        } else if (name in MARKED) {
          out.push(mark(MARKED[name]).range(node.from, node.to));
        } else if (
          MARKUP.has(name) &&
          parent &&
          MARKUP_PARENTS.has(parent.name)
        ) {
          const singleLine =
            state.doc.lineAt(node.from).number ===
            state.doc.lineAt(node.to).number;
          const resolved =
            parent.name !== "Link" || linkHref(state, parent, defs) !== null;
          if (!resolved) return;
          if (singleLine && !touches(parent.from, parent.to))
            out.push(hide.range(node.from, node.to));
          else out.push(markup.range(node.from, node.to));
        } else if (name === "FootnoteReference") {
          const number = footnoteNumber(
            FOOTNOTE_REFERENCE.exec(state.sliceDoc(node.from, node.to))![1],
          );
          if (number === undefined) return;
          if (!touches(node.from, node.to))
            out.push(
              Decoration.replace({
                widget: new FootnoteRefWidget(number),
              }).range(node.from, node.to),
            );
          else out.push(markup.range(node.from, node.to));
        } else if (name === "FootnoteDefinition") {
          eachLine(node.from, node.to, (start) =>
            out.push(line("cm-footnote").range(start)),
          );
        } else if (name === "FootnoteLabel") {
          if (!touches(parent!.from, parent!.to)) {
            const label = state.sliceDoc(node.from + 2, node.to - 2);
            out.push(
              Decoration.replace({
                widget: new FootnoteLabelWidget(label),
              }).range(node.from, withSpace(node.to)),
            );
          } else {
            out.push(markup.range(node.from, node.to));
          }
        } else if (name === "TableDelimiter") {
          out.push(markup.range(node.from, node.to));
        } else if (name === "LinkReference") {
          eachLine(node.from, node.to, (start) =>
            out.push(line("cm-link-definition").range(start)),
          );
        }
      },
    });
  }

  for (const [start, depth] of quoted)
    out.push(
      Decoration.line({
        class: cn("cm-quote", quotedCode.has(start) && "cm-quote-code"),
        attributes: {
          style: quoteStyle(
            depth,
            quotedLists.get(start),
            quotedCode.has(start),
          ),
        },
      }).range(start),
    );

  return Decoration.set(out, true);
};

const replacements = (decorations: DecorationSet) =>
  decorations.update({ filter: (_from, _to, value) => !value.spec.class });

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view.state, view.visibleRanges);
      this.atomic = replacements(this.decorations);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.startState.facet(sourceMode) !==
          update.state.facet(sourceMode) ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = build(update.state, update.view.visibleRanges);
        this.atomic = replacements(this.decorations);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
    provide: (self) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(self)?.atomic ?? Decoration.none,
      ),
  },
);

const buildTables = (state: EditorState) => {
  const selection = state.selection.ranges;
  const references: string[] = [];
  const found: SyntaxNode[] = [];
  for (
    let node = syntaxTree(state).topNode.firstChild;
    node;
    node = node.nextSibling
  ) {
    if (node.name === "LinkReference")
      references.push(state.sliceDoc(node.from, node.to));
    else if (node.name === "Table") found.push(node);
  }

  const out: Range<Decoration>[] = [];
  for (const node of found) {
    const atLineStart = state.doc.lineAt(node.from).from === node.from;
    const atLineEnd = state.doc.lineAt(node.to).to === node.to;
    const touched =
      state.facet(sourceMode) ||
      selection.some((r) => r.from <= node.to && r.to >= node.from);
    if (atLineStart && atLineEnd && !touched)
      out.push(
        Decoration.replace({
          widget: new TableWidget(
            [state.sliceDoc(node.from, node.to), ...references].join("\n\n"),
          ),
          block: true,
        }).range(node.from, node.to),
      );
  }
  return Decoration.set(out);
};

const tables = StateField.define<DecorationSet>({
  create: buildTables,
  update: (value, tr) =>
    tr.docChanged ||
    tr.selection ||
    tr.startState.facet(sourceMode) !== tr.state.facet(sourceMode) ||
    syntaxTree(tr.state) !== syntaxTree(tr.startState)
      ? buildTables(tr.state)
      : value,
  provide: (field) => EditorView.decorations.from(field),
});

const openLinks = EditorView.domEventHandlers({
  click(event, view) {
    if (!isModKey(event)) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;

    let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(
      view.state,
    ).resolveInner(pos);
    while (node && node.name !== "Link") node = node.parent;
    if (!node) return false;
    const href = linkHref(view.state, node, linkDefinitions(view.state));
    if (href === null) return false;

    if (isValidUrl(href)) openExternal(href);
    return true;
  },
});

const enterTable = (down: boolean) => (view: EditorView) => {
  const { doc, selection } = view.state;
  const head = selection.main.head;
  const line = doc.lineAt(head);
  const edge = down ? line.to + 1 : line.from - 1;
  const found: { from: number; to: number }[] = [];
  view.state.field(tables).between(edge, edge, (from, to) => {
    if (down ? from === edge : to === edge) found.push({ from, to });
  });
  if (!found.length || !selection.main.empty) return false;

  const target = view.moveVertically(selection.main, down).head;
  if (down ? target < edge : target > edge) return false;

  const table = found[0];
  const row = doc.lineAt(down ? table.from : table.to);
  const anchor = row.from + Math.min(head - line.from, row.length);
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
  return true;
};

const enterCollapsed = (down: boolean) => (view: EditorView) => {
  const { doc, selection } = view.state;
  const { main } = selection;
  const line = doc.lineAt(main.head);
  if (!main.empty || line.number === (down ? doc.lines : 1)) return false;

  const moved = view.moveVertically(main, down).head;
  if (down ? moved <= line.to : moved >= line.from) return false;

  const target = doc.line(line.number + (down ? 1 : -1));
  let collapsed = false;
  view
    .plugin(plugin)
    ?.decorations.between(target.from, target.from, (_f, _t, value) => {
      if (value.spec.class?.includes("cm-collapsed")) collapsed = true;
    });
  if (!collapsed) return false;

  const anchor = target.from + Math.min(main.head - line.from, target.length);
  view.dispatch({ selection: { anchor }, scrollIntoView: true });
  return true;
};

export const livePreview = [
  plugin,
  tables,
  Prec.high(
    keymap.of([
      { key: "ArrowDown", run: enterTable(true) },
      { key: "ArrowUp", run: enterTable(false) },
      { key: "ArrowDown", run: enterCollapsed(true) },
      { key: "ArrowUp", run: enterCollapsed(false) },
    ]),
  ),
  openLinks,
];
