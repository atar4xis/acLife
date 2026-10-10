import DropOverlay from "@/components/journal/DropOverlay";
import JournalEditor from "@/components/journal/JournalEditor";
import JournalMarkdown from "@/components/journal/JournalMarkdown";
import JournalTabs from "@/components/journal/JournalTabs";
import NoteTitle from "@/components/journal/NoteTitle";
import { useJournalActions, useJournalItems } from "@/context/JournalContext";
import type { PaneNode } from "@/types/Journal";
import { useCallback, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";

export default function JournalPane({ pane }: { pane: PaneNode }) {
  const { t } = useTranslation();
  const journal = useJournalActions();
  const items = useJournalItems();
  const editor = useRef<{ focus: () => void }>(null);
  const note = items.find((item) => item.id === pane.active);
  const focusEditor = useCallback(() => editor.current?.focus(), []);

  return (
    <section
      className="relative flex size-full min-w-0 flex-col"
      onPointerDownCapture={() => journal.focusPane(pane.id)}
      onFocusCapture={() => journal.focusPane(pane.id)}
    >
      <JournalTabs pane={pane} />
      <div className="relative min-h-0 flex-1">
        <div className="flex size-full flex-col overflow-auto">
          {note ? (
            <>
              <NoteTitle id={note.id} name={note.name} onEnter={focusEditor} />
              {pane.reading ? (
                <article className="mx-auto w-full max-w-3xl px-6 pb-12">
                  <JournalMarkdown>{note.content}</JournalMarkdown>
                </article>
              ) : (
                <JournalEditor
                  key={note.id}
                  ref={editor}
                  value={note.content}
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
        <DropOverlay pane={pane} />
      </div>
    </section>
  );
}
