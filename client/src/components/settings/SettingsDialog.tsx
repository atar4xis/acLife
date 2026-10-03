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
import { loadTimezones } from "@/lib/calendar/timezone";
import { normalize, tokenize } from "@/lib/utils";
import SettingsNav from "./SettingsNav";
import {
  settingsCategories,
  buildSearchIndex,
  type SearchHit,
} from "./settingsData";
import AppearancePage from "./pages/AppearancePage";
import SubscriptionPage from "./pages/SubscriptionPage";
import SecurityPage from "./pages/SecurityPage";
import RegionPage from "./pages/RegionPage";
import CalendarPage from "./pages/CalendarPage";
import SyncPage from "./pages/SyncPage";
import type { SectionRefs } from "./SettingsSection";
import { useTranslation } from "react-i18next";

const PAGES: Record<string, ComponentType<{ sectionRefs: SectionRefs }>> = {
  appearance: AppearancePage,
  subscription: SubscriptionPage,
  security: SecurityPage,
  region: RegionPage,
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
  const { t } = useTranslation();
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

  // warms the time zone cache in the background before the calendar page needs it
  useEffect(() => {
    loadTimezones();
  }, []);

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

  // visited pages stay mounted so switching back is instant
  const [visitedIds, setVisitedIds] = useState(new Set<string>());
  const pagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisitedIds((prev) => {
      if (!open) return prev.size ? new Set() : prev;
      return prev.has(activeCategory.id)
        ? prev
        : new Set(prev).add(activeCategory.id);
    });
  }, [open, activeCategory.id]);

  useEffect(() => {
    pagesRef.current
      ?.closest('[data-slot="scroll-area-viewport"]')
      ?.scrollTo(0, 0);
  }, [activeCategory.id]);

  const results = useMemo(() => {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const visibleIds = new Set(visibleCategories.map((c) => c.id));

    return buildSearchIndex()
      .filter((hit) => visibleIds.has(hit.categoryId))
      .filter((hit) => {
        const haystack = normalize(
          `${hit.itemLabel} ${hit.categoryLabel} ${hit.sectionLabel}`,
        );
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 8);
    // eslint-disable-next-line
  }, [query, visibleCategories, t]);

  const stopFollowing = useRef<(() => void) | null>(null);
  useEffect(() => () => stopFollowing.current?.(), []);

  const scrollToSection = (sectionId: string) => {
    const el = sectionRefs.current.get(sectionId);
    const viewport = pagesRef.current?.closest(
      '[data-slot="scroll-area-viewport"]',
    );
    if (!el) return;

    el.scrollIntoView({ block: "start", behavior: "smooth" });

    // deferred content grows after mounting, keep the section aligned until it settles
    stopFollowing.current?.();
    if (!pagesRef.current || !viewport) return;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) return void (first = false);
      el.scrollIntoView({ block: "start" });
    });
    observer.observe(pagesRef.current);
    const events = ["wheel", "touchstart", "keydown", "pointerdown"];
    const stop = () => {
      observer.disconnect();
      clearTimeout(timeout);
      events.forEach((e) => viewport.removeEventListener(e, stop));
      stopFollowing.current = null;
    };
    const timeout = setTimeout(stop, 2000);
    events.forEach((e) =>
      viewport.addEventListener(e, stop, { passive: true }),
    );
    stopFollowing.current = stop;
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
      <DialogContent className="flex h-[min(840px,85vh)] w-[min(1280px,95vw)] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <DialogTitle className="sr-only">{t("common.settings")}</DialogTitle>
        {isMobile && (
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="ring-offset-background focus:ring-ring absolute top-4 start-4 z-10 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden"
          >
            <Menu className="size-4" />
            <span className="sr-only">{t("settings.openNav")}</span>
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
              <div ref={pagesRef} className="p-6">
                {visibleCategories
                  .filter(
                    (category) =>
                      category.id === activeCategory.id ||
                      visitedIds.has(category.id),
                  )
                  .map((category) => {
                    const Page = PAGES[category.id];
                    return (
                      <div
                        key={category.id}
                        hidden={category.id !== activeCategory.id}
                      >
                        <Page sectionRefs={sectionRefs} />
                      </div>
                    );
                  })}
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
              <SheetTitle className="sr-only">{t("settings.nav")}</SheetTitle>
              {renderNav(() => setNavOpen(false))}
            </SheetContent>
          </Sheet>
        )}
      </DialogContent>
      <DialogDescription></DialogDescription>
    </Dialog>
  );
}
