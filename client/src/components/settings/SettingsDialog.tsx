import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { Menu } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { normalize, tokenize } from "@/lib/utils";
import SettingsNav from "./SettingsNav";
import {
  settingsCategories,
  searchIndex,
  type SearchHit,
} from "./settingsData";
import AppearancePage from "./pages/AppearancePage";
import SubscriptionPage from "./pages/SubscriptionPage";
import SecurityPage from "./pages/SecurityPage";
import CalendarPage from "./pages/CalendarPage";
import SyncPage from "./pages/SyncPage";
import type { SectionRefs } from "./SettingsSection";

const PAGES: Record<string, ComponentType<{ sectionRefs: SectionRefs }>> = {
  appearance: AppearancePage,
  subscription: SubscriptionPage,
  security: SecurityPage,
  calendar: CalendarPage,
  sync: SyncPage,
};

export default function SettingsDialog({
  open,
  onOpenChange,
  offlineUser = false,
  subscriptionEnabled = true,
  initialCategoryId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offlineUser?: boolean;
  subscriptionEnabled?: boolean;
  initialCategoryId?: string;
}) {
  const isMobile = useIsMobile();

  const visibleCategories = useMemo(
    () =>
      settingsCategories.filter(
        (category) =>
          !(offlineUser && category.hideOffline) &&
          !(!subscriptionEnabled && category.hideIfNoSubscription),
      ),
    [offlineUser, subscriptionEnabled],
  );

  const [activeCategoryId, setActiveCategoryId] = useState(
    visibleCategories[0].id,
  );

  useEffect(() => {
    if (open && initialCategoryId) setActiveCategoryId(initialCategoryId);
  }, [open, initialCategoryId]);
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingSectionId = useRef<string | null>(null);

  const activeCategory =
    visibleCategories.find((category) => category.id === activeCategoryId) ??
    visibleCategories[0];
  const ActivePage = PAGES[activeCategory.id];

  const results = useMemo(() => {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const visibleIds = new Set(visibleCategories.map((c) => c.id));

    return searchIndex
      .filter((hit) => visibleIds.has(hit.categoryId))
      .filter((hit) => {
        const haystack = normalize(
          `${hit.itemLabel} ${hit.categoryLabel} ${hit.sectionLabel}`,
        );
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 8);
  }, [query, visibleCategories]);

  const scrollToSection = (sectionId: string) => {
    sectionRefs.current
      .get(sectionId)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  useEffect(() => {
    if (!pendingSectionId.current) return;
    const sectionId = pendingSectionId.current;
    pendingSectionId.current = null;
    requestAnimationFrame(() => scrollToSection(sectionId));
  }, [activeCategoryId]);

  const goToCategory = (categoryId: string) => {
    setActiveCategoryId(categoryId);
    setNavOpen(false);
  };

  const goToSection = (categoryId: string, sectionId: string) => {
    if (categoryId === activeCategoryId) {
      scrollToSection(sectionId);
    } else {
      pendingSectionId.current = sectionId;
      setActiveCategoryId(categoryId);
    }
    setNavOpen(false);
  };

  const selectHit = (hit: SearchHit) => {
    setQuery("");
    goToSection(hit.categoryId, hit.sectionId);
  };

  const renderNav = (onClose?: () => void) => (
    <SettingsNav
      categories={visibleCategories}
      query={query}
      onQueryChange={setQuery}
      results={results}
      onSelectHit={selectHit}
      activeCategoryId={activeCategoryId}
      onSelectCategory={goToCategory}
      onSelectSection={goToSection}
      onClose={onClose}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(720px,85vh)] w-[min(1100px,95vw)] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        {isMobile && (
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="ring-offset-background focus:ring-ring absolute top-4 left-4 z-10 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden"
          >
            <Menu className="size-4" />
            <span className="sr-only">Open settings navigation</span>
          </button>
        )}
        <div className="flex min-h-0 flex-1">
          {!isMobile && (
            <>
              <div className="w-64 shrink-0">{renderNav()}</div>
              <Separator orientation="vertical" />
            </>
          )}
          <div className="flex min-h-0 flex-1 flex-col">
            {isMobile && <div className="h-12 shrink-0 border-b" />}
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-6">
                <ActivePage sectionRefs={sectionRefs} />
              </div>
            </ScrollArea>
          </div>
        </div>
        {isMobile && (
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetContent
              side="left"
              className="w-72 p-0"
              showCloseButton={false}
            >
              <SheetTitle className="sr-only">Settings navigation</SheetTitle>
              {renderNav(() => setNavOpen(false))}
            </SheetContent>
          </Sheet>
        )}
      </DialogContent>
      <DialogDescription></DialogDescription>
    </Dialog>
  );
}
