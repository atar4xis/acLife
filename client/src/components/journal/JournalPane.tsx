import DropOverlay from "@/components/journal/DropOverlay";
import JournalEditor from "@/components/journal/JournalEditor";
import JournalMarkdown from "@/components/journal/JournalMarkdown";
import JournalTabs from "@/components/journal/JournalTabs";
import NoteTitle from "@/components/journal/NoteTitle";
import ScrollThumb from "@/components/ui/scroll-thumb";
import { useJournalActions, useJournalItems } from "@/context/JournalContext";
import type { PaneNode } from "@/types/Journal";
import {
  FOLLOW_MS,
  type JournalEditorHandle,
  MAX_DRIFT,
  SCROLL_INTERRUPTS,
  readerTopLine,
  scrollReaderToLine,
} from "@/lib/journal/scrollAnchor";
import { useCallback, useEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";

export default function JournalPane({ pane }: { pane: PaneNode }) {
  const { t } = useTranslation();
  const journal = useJournalActions();
  const items = useJournalItems();
  const editor = useRef<JournalEditorHandle>(null);
  const anchor = useRef(1);
  const reading = !!pane.reading;
  const mode = useRef(reading);
  const scroller = useRef<HTMLDivElement>(null);
  const note = items.find((item) => item.id === pane.active);
  const focusEditor = useCallback(() => editor.current?.focus(), []);

  const captureAnchor = (e: React.SyntheticEvent) => {
    const box = scroller.current;
    if (!box || !(e.target as HTMLElement).closest("[data-reading-toggle]"))
      return;
    anchor.current = reading
      ? readerTopLine(box)
      : (editor.current?.topLine(box.getBoundingClientRect().top) ?? 1);
  };

  useEffect(() => {
    if (mode.current === reading) return;
    mode.current = reading;
    const box = scroller.current!;
    const apply = () => {
      if (reading) return scrollReaderToLine(box, anchor.current);
      const drift = editor.current?.topLine(box.getBoundingClientRect().top);
      if (drift === undefined || Math.abs(drift - anchor.current) > MAX_DRIFT)
        editor.current?.scrollToLine(anchor.current);
    };

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    const stop = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      observer.disconnect();
      SCROLL_INTERRUPTS.forEach((type) => box.removeEventListener(type, stop));
    };
    const timer = setTimeout(stop, FOLLOW_MS);
    SCROLL_INTERRUPTS.forEach((type) => box.addEventListener(type, stop));
    Array.from(box.children).forEach((child) => observer.observe(child));
    return stop;
  }, [reading]);

  return (
    <section
      className="relative flex size-full min-w-0 flex-col"
      onPointerDownCapture={() => journal.focusPane(pane.id)}
      onClickCapture={captureAnchor}
      onFocusCapture={() => journal.focusPane(pane.id)}
    >
      <JournalTabs pane={pane} />
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          className="hide-scrollbar flex size-full flex-col overflow-auto"
        >
          {note ? (
            <>
              <NoteTitle id={note.id} name={note.name} onEnter={focusEditor} />
              {pane.reading ? (
                <article className="relative mx-auto w-full max-w-3xl px-6 pb-12">
                  <JournalMarkdown>{note.content}</JournalMarkdown>
                </article>
              ) : (
                <JournalEditor
                  key={note.id}
                  ref={editor}
                  value={note.content}
                  source={!!pane.source}
                  label={t("journal.editor")}
                  placeholder={t("journal.placeholder")}
                  onChange={(content) => journal.setContent(note.id, content)}
                />
              )}
            </>
          ) : (
            <p className="text-muted-foreground p-6 text-center text-sm">
              <Trans
                i18nKey="journal.selectNote"
                components={{
                  create: (
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() =>
                        journal.openNote(journal.addItem("note", null))
                      }
                    />
                  ),
                }}
              />
            </p>
          )}
        </div>
        <ScrollThumb gridRef={scroller} />
        <DropOverlay pane={pane} />
      </div>
    </section>
  );
}
