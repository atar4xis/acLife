import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import SettingsTree from "./SettingsTree";
import type { SearchHit, SettingsCategory } from "./settingsData";

export default function SettingsNav({
  categories,
  query,
  onQueryChange,
  results,
  onSelectHit,
  activeCategoryId,
  onSelectCategory,
  onSelectSection,
  onClose,
}: {
  categories: SettingsCategory[];
  query: string;
  onQueryChange: (query: string) => void;
  results: SearchHit[];
  onSelectHit: (hit: SearchHit) => void;
  activeCategoryId: string;
  onSelectCategory: (categoryId: string) => void;
  onSelectSection: (categoryId: string, sectionId: string) => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="relative p-3">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search settings..."
          className="pl-9"
        />
        {results.length > 0 && (
          <div className="bg-popover absolute inset-x-3 top-full z-10 mt-1 rounded-md border shadow-md">
            {results.map((hit) => (
              <button
                key={hit.itemId}
                type="button"
                onClick={() => onSelectHit(hit)}
                className="hover:bg-accent hover:text-accent-foreground flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left first:rounded-t-md last:rounded-b-md"
              >
                <span className="text-sm">{hit.itemLabel}</span>
                <span className="text-muted-foreground text-xs">
                  {hit.categoryLabel}
                  {hit.categoryLabel !== hit.sectionLabel &&
                    ` / ${hit.sectionLabel}`}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3 pt-0">
          <SettingsTree
            categories={categories}
            activeCategory={activeCategoryId}
            onSelectCategory={onSelectCategory}
            onSelectSection={onSelectSection}
          />
        </div>
      </ScrollArea>
      {onClose && (
        <div className="border-t p-3">
          <Button variant="outline" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
