import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTranslation } from "react-i18next";

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  labelledBy?: string;
  className?: string;
  debounceMs?: number;
  maxResults?: number;
}

const isWordStart = (text: string, token: string) =>
  text.startsWith(token) ||
  text.includes(` ${token}`) ||
  text.includes(`, ${token}`);

// lower is better, label matches outrank description and search text matches
function scoreOption(
  option: SearchableSelectOption,
  tokens: string[],
): number | null {
  const label = option.label.toLowerCase();
  const rest =
    `${option.description ?? ""} ${option.searchText ?? ""}`.toLowerCase();
  let total = 0;
  for (const token of tokens) {
    if (label.startsWith(token)) total += 0;
    else if (isWordStart(label, token)) total += 1;
    else if (label.includes(token)) total += 2;
    else if (isWordStart(rest, token)) total += 10;
    else if (rest.includes(token)) total += 11;
    else return null;
  }
  return total;
}

function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled,
  labelledBy,
  className,
  debounceMs = 200,
  maxResults = 50,
}: SearchableSelectProps) {
  const { t } = useTranslation();
  placeholder ??= t("common.select");
  searchPlaceholder ??= t("common.search");
  emptyMessage ??= t("common.noResults");
  const listId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebouncedValue(query, debounceMs)
    .trim()
    .toLowerCase();

  const showResults = query.trim() !== "" && debouncedQuery !== "";

  const selected = options.find((o) => o.value === value);

  const results = React.useMemo(() => {
    if (!debouncedQuery) return [];
    const tokens = debouncedQuery.split(/\s+/);
    const matches: { option: SearchableSelectOption; score: number }[] = [];
    for (const option of options) {
      const score = scoreOption(option, tokens);
      if (score !== null) matches.push({ option, score });
    }
    // stable sort keeps the original option order within equal scores
    return matches
      .toSorted((a, b) => a.score - b.score)
      .slice(0, maxResults)
      .map((m) => m.option);
  }, [options, debouncedQuery, maxResults]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  React.useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  const select = (option: SearchableSelectOption) => {
    onValueChange(option.value);
    handleOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      select(results[activeIndex]);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={labelledBy}
          data-slot="searchable-select-trigger"
          className={cn(
            "border-input dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span
            className={cn("truncate", !selected && "text-muted-foreground")}
          >
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-(--radix-popover-trigger-width) min-w-72 p-0"
      >
        <div className={cn("p-2", showResults && "border-b")}>
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
          />
        </div>
        {showResults && (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            className="max-h-72 overflow-y-auto p-1"
          >
            {debouncedQuery && results.length === 0 && (
              <div className="text-muted-foreground px-2 py-6 text-center text-sm">
                {emptyMessage}
              </div>
            )}
            {results.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                data-index={index}
                onClick={() => select(option)}
                onPointerMove={() => setActiveIndex(index)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start outline-none",
                  index === activeIndex && "bg-accent text-accent-foreground",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-foreground truncate text-sm">
                    {option.label}
                  </div>
                  {option.description && (
                    <div className="text-muted-foreground truncate text-xs">
                      {option.description}
                    </div>
                  )}
                </div>
                {option.value === value && (
                  <Check className="size-4 shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export { SearchableSelect };
