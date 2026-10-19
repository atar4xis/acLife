import DropOverlay from "@/components/journal/DropOverlay";
import JournalEditor from "@/components/journal/JournalEditor";
import JournalMarkdown from "@/components/journal/JournalMarkdown";
import StatusBar, {
  type Cursor,
  type StatusBarHandle,
} from "@/components/journal/StatusBar";
import JournalTabs from "@/components/journal/JournalTabs";
import NoteTitle from "@/components/journal/NoteTitle";
import ScrollThumb from "@/components/ui/scroll-thumb";
import { useJournalActions, useJournalItems } from "@/context/JournalContext";
import { useJournalSettings } from "@/context/JournalSettingsContext";
import { canEditItem } from "@/lib/journal/shared";
import type { PaneNode } from "@/types/Journal";
import {
  FOLLOW_MS,
  type JournalEditorHandle,
  MAX_DRIFT,
  SCROLL_INTERRUPTS,
  readerTopLine,
  scrollReaderToLine,
} from "@/lib/journal/scrollAnchor";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";

export default function JournalPane({ pane }: { pane: PaneNode }) {
  const { t } = useTranslation();
  const journal = useJournalActions();
  const items = useJournalItems();
  const editor = useRef<JournalEditorHandle>(null);
  const anchor = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);
  const note = items.find((item) => item.id === pane.active);
  const editable = !!note && canEditItem(note);
  const locked = !!note && !editable;
  const reading = !!pane.reading || locked;
  const mode = useRef(reading);
  const settings = useJournalSettings((s) => ({
    showTitle: s.journalShowTitle,
    lineNumbers: s.journalLineNumbers,
    statusBar: s.journalStatusBar,
  }));
  const cursor = useRef<Cursor>({ line: 1, column: 1 });
  const statusBar = useRef<StatusBarHandle>(null);
  const focusEditor = useCallback(() => editor.current?.focus(), []);

  const noteRef = useRef(note);
  noteRef.current = note;

  const toggleTask = useCallback(
    (line: number) => {
      const current = noteRef.current!;
      if (!canEditItem(current)) return;
      const lines = current.content.split("\n");
      lines[line - 1] = lines[line - 1].replace(/\[[ xX]\]/, (marker) =>
        marker === "[ ]" ? "[x]" : "[ ]",
      );
      journal.setContent(current.id, lines.join("\n"));
    },
    [journal],
  );

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
      <JournalTabs pane={pane} reading={reading} locked={locked} />
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          className={cn(
            "hide-scrollbar flex size-full flex-col overflow-auto",
            !settings.showTitle && "pt-6",
          )}
        >
          {note ? (
            <>
              {settings.showTitle && (
                <NoteTitle
                  id={note.id}
                  name={note.name}
                  onEnter={focusEditor}
                  readOnly={!editable}
                />
              )}
              {reading ? (
                <article className="relative mx-auto w-full max-w-3xl px-6 pb-12">
                  <JournalMarkdown onToggleTask={toggleTask}>
                    {note.content}
                  </JournalMarkdown>
                </article>
              ) : (
                <JournalEditor
                  key={note.id}
                  ref={editor}
                  value={note.content}
                  source={!!pane.source}
                  lineNumbers={settings.lineNumbers}
                  onCursor={(line, column) => {
                    cursor.current = { line, column };
                    statusBar.current?.setCursor(cursor.current);
                  }}
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
      {note && settings.statusBar && (
        <StatusBar
          ref={statusBar}
          content={note.content}
          initialCursor={cursor.current}
          showCursor={!reading}
        />
      )}
    </section>
  );
}
