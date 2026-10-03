import { cn } from "@/lib/utils";
import {
  categoryLabel,
  sectionLabel,
  type SettingsCategory,
} from "./settingsData";

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
  return (
    <nav className="flex flex-col gap-0.5">
      {categories.map((category) => {
        const isActive = category.id === activeCategory;
        const hasChildren = category.sections.length > 1;

        return (
          <div key={category.id}>
            <button
              type="button"
              onClick={() => onSelectCategory(category.id)}
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground",
                isActive && "bg-accent text-accent-foreground font-medium",
              )}
            >
              {categoryLabel(category.id)}
            </button>
            {hasChildren && (
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
