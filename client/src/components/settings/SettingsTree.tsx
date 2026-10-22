import { useState } from "react";
import {
  BookText,
  CalendarDays,
  ChevronRight,
  CreditCard,
  Globe,
  Info,
  Paintbrush,
  RefreshCw,
  Share2,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  categoryLabel,
  sectionLabel,
  type SettingsCategory,
} from "./settingsData";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  application: Info,
  appearance: Paintbrush,
  subscription: CreditCard,
  security: Shield,
  region: Globe,
  calendar: CalendarDays,
  journal: BookText,
  sharing: Share2,
  sync: RefreshCw,
};

export default function SettingsTree({
  categories,
  activeCategory,
  onSelectCategory,
  onSelectSection,
}: {
  categories: SettingsCategory[];
  activeCategory: string;
  onSelectCategory: (categoryId: string) => void;
  onSelectSection: (categoryId: string, sectionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(new Set([activeCategory]));
  const [lastActive, setLastActive] = useState(activeCategory);

  if (lastActive !== activeCategory) {
    setLastActive(activeCategory);
    setExpanded(new Set(expanded).add(activeCategory));
  }

  const toggleExpanded = (categoryId: string) => {
    const next = new Set(expanded);
    if (!next.delete(categoryId)) next.add(categoryId);
    setExpanded(next);
  };

  const selectCategory = (categoryId: string) => {
    const next = new Set(expanded);
    if (categoryId === activeCategory && next.has(categoryId)) {
      next.delete(categoryId);
    } else {
      next.add(categoryId);
    }
    setExpanded(next);
    onSelectCategory(categoryId);
  };

  return (
    <nav className="flex flex-col gap-0.5">
      {categories.map((category) => {
        const isActive = category.id === activeCategory;
        const hasChildren = category.sections.length > 1;
        const Icon = CATEGORY_ICONS[category.id];
        const isExpanded = expanded.has(category.id);

        return (
          <div key={category.id}>
            <div
              className={cn(
                "flex items-center rounded-md hover:bg-accent hover:text-accent-foreground",
                isActive && "bg-accent text-accent-foreground font-medium",
              )}
            >
              <button
                type="button"
                onClick={() => selectCategory(category.id)}
                className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm"
              >
                <Icon className="size-4" />
                {categoryLabel(category.id)}
              </button>
              {hasChildren && (
                <button
                  type="button"
                  onClick={() => toggleExpanded(category.id)}
                  aria-expanded={isExpanded}
                  aria-label={categoryLabel(category.id)}
                  className="rounded-md p-1.5"
                >
                  <ChevronRight
                    className={cn(
                      "size-4 rtl:-scale-x-100",
                      isExpanded && "rotate-90 rtl:-rotate-90",
                    )}
                  />
                </button>
              )}
            </div>
            {hasChildren && isExpanded && (
              <div className="ms-3 flex flex-col gap-0.5 border-s ps-2 py-0.5">
                {category.sections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => onSelectSection(category.id, section.id)}
                    className="rounded-md px-2 py-1 text-start text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {sectionLabel(section.id)}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
