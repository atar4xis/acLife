import JournalLayout from "@/components/journal/JournalLayout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useJournal } from "@/context/JournalContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTranslation } from "react-i18next";

export default function JournalView() {
  const { t } = useTranslation();
  const { loadFailed } = useJournal();
  const isMobile = useIsMobile();

  return (
    <main className="flex h-screen w-full min-w-0 flex-col">
      {isMobile && (
        <nav className="flex items-center border-b p-3">
          <SidebarTrigger />
        </nav>
      )}
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
