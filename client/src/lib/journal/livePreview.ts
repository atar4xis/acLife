import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/nativeUpdater";
import { isValidUrl } from "@/lib/validators";

const hide = Decoration.replace({});

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-rule";
    return rule;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
  ) {
    super();
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", () =>
      view.dispatch({
        changes: {
          from: this.from,
          to: this.from + 3,
          insert: this.checked ? "[ ]" : "[x]",
        },
      }),
    );
    return box;
  }

  ignoreEvent() {
    return false;
  }
}

const line = (name: string) => Decoration.line({ class: name });
const mark = (name: string) => Decoration.mark({ class: name });

const MARKED: Record<string, string> = {
  StrongEmphasis: "cm-strong",
  Emphasis: "cm-em",
  Strikethrough: "cm-strike",
  InlineCode: "cm-code",
  Link: "cm-link",
  ListMark: "cm-list-mark",
};

const MARKUP = new Set([
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "LinkMark",
  "URL",
  "LinkTitle",
]);

const MARKUP_PARENTS = new Set([
  "StrongEmphasis",
  "Emphasis",
  "Strikethrough",
  "InlineCode",
  "Link",
]);

const build = (
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
) => {
  const out: Range<Decoration>[] = [];
  const selection = state.selection.ranges;
  const touches = (from: number, to: number) =>
    selection.some((r) => r.from <= to && r.to >= from);
  const lineTouches = (from: number, to: number) =>
    touches(state.doc.lineAt(from).from, state.doc.lineAt(to).to);
  const withSpace = (to: number) =>
    state.sliceDoc(to, to + 1) === " " ? to + 1 : to;

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

        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          out.push(
            line(`cm-h cm-h${heading[1]}`).range(
              state.doc.lineAt(node.from).from,
            ),
          );
        } else if (name === "HeaderMark" && parent?.name.startsWith("ATX")) {
          if (!lineTouches(node.from, node.to))
            out.push(hide.range(node.from, withSpace(node.to)));
        } else if (name === "Blockquote") {
          eachLine(node.from, node.to, (start) =>
            out.push(line("cm-quote").range(start)),
          );
        } else if (name === "QuoteMark") {
          if (!lineTouches(node.from, node.to))
            out.push(hide.range(node.from, withSpace(node.to)));
        } else if (name === "FencedCode") {
          eachLine(node.from, node.to, (start, i, last) =>
            out.push(
              line(
                cn(
                  "cm-codeblock",
                  i === 0 && "cm-codefence cm-code-first",
                  last && "cm-codefence cm-code-last",
                ),
              ).range(start),
            ),
          );
        } else if (name === "CodeMark" && parent?.name === "FencedCode") {
          if (!touches(parent.from, parent.to))
            out.push(hide.range(node.from, node.to));
        } else if (name === "CodeInfo") {
          if (!touches(parent!.from, parent!.to))
            out.push(hide.range(node.from, node.to));
        } else if (name === "HorizontalRule") {
          if (!lineTouches(node.from, node.to))
            out.push(
              Decoration.replace({ widget: new RuleWidget() }).range(
                node.from,
                node.to,
              ),
            );
        } else if (name === "TaskMarker") {
          if (!touches(node.from, node.to)) {
            const checked = state.sliceDoc(node.from, node.to) !== "[ ]";
            out.push(
              Decoration.replace({
                widget: new CheckboxWidget(checked, node.from),
              }).range(node.from, node.to),
            );
          }
        } else if (name === "ListMark") {
          const bullet = parent?.parent?.name === "BulletList";
          if (bullet && !lineTouches(node.from, node.to)) {
            out.push(
              Decoration.replace({ widget: new BulletWidget() }).range(
                node.from,
                node.to,
              ),
            );
          } else {
            out.push(mark(MARKED[name]).range(node.from, node.to));
          }
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
          if (singleLine && !touches(parent.from, parent.to))
            out.push(hide.range(node.from, node.to));
        }
      },
    });
  }

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

const openLinks = EditorView.domEventHandlers({
  click(event, view) {
    if (!event.ctrlKey && !event.metaKey) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;

    let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(
      view.state,
    ).resolveInner(pos);
    while (node && node.name !== "Link") node = node.parent;
    const url = node?.getChild("URL");
    if (!url) return false;

    const href = view.state.sliceDoc(url.from, url.to);
    if (isValidUrl(href)) openExternal(href);
    return true;
  },
});

export const livePreview = [plugin, openLinks];

export const journalTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "inherit", flex: "1" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.7",
    overflow: "visible",
  },
  ".cm-content": {
    maxWidth: "48rem",
    margin: "0 auto",
    padding: "0 1.5rem 3rem",
    caretColor: "var(--foreground)",
  },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
    {
      background: "color-mix(in oklab, var(--primary) 30%, transparent)",
    },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
  ".cm-h": { fontWeight: "700", lineHeight: "1.3" },
  ".cm-h1": { fontSize: "var(--journal-h1-size)" },
  ".cm-h2": { fontSize: "var(--journal-h2-size)" },
  ".cm-h3": { fontSize: "var(--journal-h3-size)" },
  ".cm-h4": { fontSize: "var(--journal-h4-size)" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strike": { textDecoration: "line-through" },
  ".cm-code": {
    fontFamily: "ui-monospace, monospace",
    backgroundColor: "var(--muted)",
    borderRadius: "0.25rem",
  },
  ".cm-link": { color: "var(--primary)", textDecoration: "underline" },
  ".cm-list-mark": { color: "var(--muted-foreground)" },
  ".cm-quote": {
    borderInlineStart: "3px solid var(--border)",
    paddingInlineStart: "1rem !important",
    color: "var(--muted-foreground)",
  },
  ".cm-codeblock": {
    fontFamily: "ui-monospace, monospace",
    fontSize: "0.875rem",
    backgroundColor: "var(--muted)",
    paddingInline: "1rem !important",
  },
  ".cm-codefence": { color: "var(--muted-foreground)" },
  ".cm-code-first": {
    borderStartStartRadius: "0.5rem",
    borderStartEndRadius: "0.5rem",
    paddingTop: "0.5rem !important",
  },
  ".cm-code-last": {
    borderEndStartRadius: "0.5rem",
    borderEndEndRadius: "0.5rem",
    paddingBottom: "0.5rem !important",
  },
  ".cm-bullet": { display: "inline-block", width: "1ch", textAlign: "center" },
  ".cm-rule": {
    display: "inline-block",
    width: "100%",
    borderTop: "1px solid var(--border)",
    verticalAlign: "middle",
  },
  ".cm-task": {
    accentColor: "var(--primary)",
    marginInlineEnd: "0.5rem",
    verticalAlign: "middle",
  },
});
