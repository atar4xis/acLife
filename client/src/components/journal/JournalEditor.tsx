import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Annotation, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import {
  type Ref,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
} from "react";
import { MAX_JOURNAL_CONTENT_LENGTH } from "@/lib/journal/item";
import type { JournalEditorHandle } from "@/lib/journal/scrollAnchor";
import { livePreview } from "@/lib/journal/livePreview";
import { footnotes, singleTilde } from "@/lib/journal/markdownParser";
import { journalTheme } from "@/lib/journal/previewTheme";

const external = Annotation.define<boolean>();
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

export default function JournalEditor({
  value,
  placeholder,
  label,
  onChange,
  ref,
}: {
  value: string;
  placeholder: string;
  label: string;
  onChange: (value: string) => void;
  ref?: Ref<JournalEditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initialValue = useEffectEvent(() => value);
  const emit = useEffectEvent(onChange);
  const pending = useRef<string[]>([]);

  useImperativeHandle(ref, () => ({
    focus: () => view.current?.focus(),
    topLine: (top) => {
      const editor = view.current!;
      const y = Math.max(0, top - editor.documentTop);
      const block = editor.lineBlockAtHeight(y);
      return (
        editor.state.doc.lineAt(block.from).number +
        (y - block.top) / block.height
      );
    },
    scrollToLine: (line) => {
      const editor = view.current!;
      const { doc } = editor.state;
      const number = Math.min(Math.floor(line), doc.lines);
      const pos = doc.line(number).from;
      editor.dispatch({
        effects: EditorView.scrollIntoView(pos, {
          y: "start",
          yMargin: -(line - number) * editor.lineBlockAt(pos).height,
        }),
      });
    },
  }));

  useEffect(() => {
    let tabReleased = false;
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initialValue(),
        extensions: [
          history(),
          EditorState.transactionFilter.of((tr) =>
            tr.docChanged &&
            !tr.annotation(external) &&
            tr.newDoc.length > MAX_JOURNAL_CONTENT_LENGTH &&
            tr.newDoc.length > tr.startState.doc.length
              ? []
              : tr,
          ),
          drawSelection(),
          EditorView.domEventHandlers({
            keydown: (e) => {
              if (e.key === "Escape") tabReleased = true;
              else if (!MODIFIER_KEYS.has(e.key) && e.key !== "Tab")
                tabReleased = false;
              return false;
            },
            blur: () => {
              tabReleased = false;
            },
          }),
          keymap.of([
            { key: "Tab", run: (v) => !tabReleased && indentMore(v) },
            { key: "Shift-Tab", run: (v) => !tabReleased && indentLess(v) },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown({ extensions: [GFM, singleTilde, footnotes] }),
          livePreview,
          journalTheme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": label }),
          placeholderExtension(placeholder),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((tr) => tr.annotation(external))
            ) {
              const text = update.state.doc.toString();
              pending.current.push(text);
              emit(text);
            }
          }),
        ],
      }),
    });
    view.current = editor;

    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [label, placeholder]);

  useEffect(() => {
    const echo = pending.current.indexOf(value);
    if (echo !== -1) {
      pending.current.splice(0, echo + 1);
      return;
    }
    pending.current = [];

    const editor = view.current!;
    const current = editor.state.doc.toString();
    if (current === value) return;

    let from = 0;
    while (
      from < current.length &&
      from < value.length &&
      current.charCodeAt(from) === value.charCodeAt(from)
    )
      from++;
    let currentEnd = current.length;
    let valueEnd = value.length;
    while (
      currentEnd > from &&
      valueEnd > from &&
      current.charCodeAt(currentEnd - 1) === value.charCodeAt(valueEnd - 1)
    ) {
      currentEnd--;
      valueEnd--;
    }

    editor.dispatch({
      changes: { from, to: currentEnd, insert: value.slice(from, valueEnd) },
      annotations: external.of(true),
    });
  }, [value]);

  return <div ref={host} className="flex flex-1 flex-col" />;
}
