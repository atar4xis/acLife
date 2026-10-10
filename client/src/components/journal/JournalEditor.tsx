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
import { journalTheme, livePreview } from "@/lib/journal/livePreview";

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
  ref?: Ref<{ focus: () => void }>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initialValue = useEffectEvent(() => value);
  const emit = useEffectEvent(onChange);
  const pending = useRef<string[]>([]);

  useImperativeHandle(ref, () => ({ focus: () => view.current?.focus() }));

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
          markdown({ extensions: GFM }),
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
    if (editor.state.doc.toString() === value) return;

    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
      annotations: external.of(true),
    });
  }, [value]);

  return <div ref={host} className="flex flex-1 flex-col" />;
}
