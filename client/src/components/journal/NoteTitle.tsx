import { useJournalActions } from "@/context/JournalContext";
import { t as translate } from "@/i18n";
import { MAX_JOURNAL_NAME_LENGTH } from "@/lib/journal/item";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

export default memo(function NoteTitle({
  id,
  name,
  onEnter,
}: {
  id: string;
  name: string;
  onEnter: () => void;
}) {
  const { t } = useTranslation();
  const { renameItem } = useJournalActions();
  const [draft, setDraft] = useState(name);
  const [syncedName, setSyncedName] = useState(name);

  if (name !== syncedName) {
    setSyncedName(name);
    setDraft(name);
  }

  return (
    <input
      aria-label={t("journal.title")}
      placeholder={t("journal.untitledNote")}
      className="mx-auto mt-6 w-full max-w-3xl bg-transparent px-6 pb-2 text-3xl font-bold outline-none"
      maxLength={MAX_JOURNAL_NAME_LENGTH}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim()) renameItem(id, e.target.value);
      }}
      onBlur={(e) => {
        const next = e.target.value.trim() || translate("journal.untitledNote");
        setDraft(next);
        if (next !== name) renameItem(id, next);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        onEnter();
      }}
    />
  );
});
