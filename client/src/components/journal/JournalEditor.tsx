import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  keymap,
  lineNumbers as lineNumbersExtension,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import {
  type Ref,
  type RefObject,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import FormatMenu from "@/components/journal/FormatMenu";
import FormatToolbar, {
  type ToolbarState,
} from "@/components/journal/FormatToolbar";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { activeFormats } from "@/lib/journal/activeFormats";
import { formatKeymap } from "@/lib/journal/formatKeymap";
import { MAX_JOURNAL_CONTENT_LENGTH } from "@/lib/journal/item";
import type { JournalEditorHandle } from "@/lib/journal/scrollAnchor";
import { livePreview, sourceMode } from "@/lib/journal/livePreview";
import { footnotes, singleTilde } from "@/lib/journal/markdownParser";
import { journalTheme } from "@/lib/journal/previewTheme";

const sameToolbar = (a: ToolbarState | null, b: ToolbarState | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.center === b.center &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.formats.join() === b.formats.join());

type Coords = ReturnType<EditorView["coordsAtPos"]>;

type Measured = { start: Coords; end: Coords; formats: string[] } | null;

const toolbarMeasure = (
  wrapper: RefObject<HTMLDivElement | null>,
  setToolbar: (
    update: (previous: ToolbarState | null) => ToolbarState | null,
  ) => void,
) => ({
  read: (view: EditorView): Measured => {
    const { from, to, empty } = view.state.selection.main;
    if (empty) return null;
    return {
      start: view.coordsAtPos(from),
      end: view.coordsAtPos(to),
      formats: activeFormats(view.state),
    };
  },
  write: (measured: Measured) => {
    if (!measured?.start || !measured.end) return setToolbar(() => null);

    const { start, end, formats } = measured;
    const wrapperRect = wrapper.current!.getBoundingClientRect();
    const isSingleLine = start.top === end.top;
    const center = isSingleLine
      ? (start.left + end.left) / 2
      : wrapperRect.left + wrapperRect.width / 2;
    const next = {
      center: center - wrapperRect.left,
      top: end.top - wrapperRect.top,
      bottom: end.bottom - wrapperRect.top,
      formats,
    };
    setToolbar((previous) => (sameToolbar(previous, next) ? previous : next));
  },
});

const external = Annotation.define<boolean>();
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

export default function JournalEditor({
  value,
  source = false,
  lineNumbers = false,
  floatingToolbar = false,
  onCursor,
  placeholder,
  label,
  onChange,
  ref,
}: {
  value: string;
  source?: boolean;
  lineNumbers?: boolean;
  floatingToolbar?: boolean;
  onCursor?: (line: number, column: number) => void;
  placeholder: string;
  label: string;
  onChange: (value: string) => void;
  ref?: Ref<JournalEditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const initialValue = useEffectEvent(() => value);
  const emit = useEffectEvent(onChange);
  const emitCursor = useEffectEvent((state: EditorState) => {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    onCursor?.(line.number, head - line.from + 1);
  });
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const coarsePointer = useCoarsePointer();
  const showToolbar = coarsePointer || floatingToolbar;
  const measureToolbar = useEffectEvent((editor: EditorView) => {
    if (showToolbar) editor.requestMeasure(toolbarMeasure(wrapper, setToolbar));
  });
  const wrapper = useRef<HTMLDivElement>(null);
  const pending = useRef<string[]>([]);
  const sourceSlot = useRef(new Compartment());
  const initialSource = useEffectEvent(() => source);
  const lineNumbersSlot = useRef(new Compartment());
  const initialLineNumbers = useEffectEvent(() => lineNumbers);

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
            ...formatKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown({ extensions: [GFM, singleTilde, footnotes] }),
          livePreview,
          sourceSlot.current.of(sourceMode.of(initialSource())),
          lineNumbersSlot.current.of(
            initialLineNumbers() ? lineNumbersExtension() : [],
          ),
          journalTheme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": label }),
          placeholderExtension(placeholder),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged)
              emitCursor(update.state);
            if (
              update.selectionSet ||
              update.docChanged ||
              update.geometryChanged
            )
              measureToolbar(update.view);
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
    emitCursor(editor.state);

    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [label, placeholder]);

  useEffect(() => {
    view.current!.dispatch({
      effects: sourceSlot.current.reconfigure(sourceMode.of(source)),
    });
  }, [source]);

  useEffect(() => {
    view.current!.dispatch({
      effects: lineNumbersSlot.current.reconfigure(
        lineNumbers ? lineNumbersExtension() : [],
      ),
    });
  }, [lineNumbers]);

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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={coarsePointer}>
        <div ref={wrapper} className="relative flex flex-1 flex-col">
          <div ref={host} className="flex flex-1 flex-col" />
          {showToolbar && toolbar && (
            <FormatToolbar viewRef={view} toolbar={toolbar} />
          )}
        </div>
      </ContextMenuTrigger>
      <FormatMenu viewRef={view} />
    </ContextMenu>
  );
}
