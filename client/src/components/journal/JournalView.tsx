import JournalLayout from "@/components/journal/JournalLayout";
import { useJournal } from "@/context/JournalContext";
import { useTranslation } from "react-i18next";

export default function JournalView() {
  const { t } = useTranslation();
  const { loadFailed } = useJournal();

  return (
    <main className="flex h-screen w-full min-w-0 flex-col">
      {loadFailed ? (
        <p className="text-destructive p-6 text-center text-sm">
          {t("journal.loadFailed")}
        </p>
      ) : (
        <JournalLayout />
      )}
    </main>
  );
}
