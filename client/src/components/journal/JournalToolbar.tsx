import IconButton from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useJournal } from "@/context/JournalContext";
import { JOURNAL_SORT_GROUPS } from "@/lib/journal/item";
import type { JournalItem, JournalSort } from "@/types/Journal";
import {
  ArrowUpDown,
  ChevronsDownUp,
  ChevronsUpDown,
  FilePlus,
  FolderPlus,
  Search,
  X,
} from "lucide-react";
import { Fragment, memo } from "react";
import { useTranslation } from "react-i18next";

export default memo(function JournalToolbar({
  query,
  setQuery,
  searching,
  searchOpen,
  setSearchOpen,
  create,
}: {
  query: string;
  setQuery: (query: string) => void;
  searching: boolean;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  create: (type: JournalItem["type"]) => void;
}) {
  const { t } = useTranslation();
  const journal = useJournal();

  return (
    <>
      <div className="flex items-center justify-between">
        <IconButton label={t("journal.newNote")} onClick={() => create("note")}>
          <FilePlus />
        </IconButton>
        <IconButton
          label={t("journal.newFolder")}
          onClick={() => create("folder")}
        >
          <FolderPlus />
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={t("journal.sortOrder")}>
              <ArrowUpDown />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup
              value={journal.sort}
              onValueChange={(sort) => journal.setSort(sort as JournalSort)}
            >
              {JOURNAL_SORT_GROUPS.map((group, i) => (
                <Fragment key={group[0]}>
                  {i > 0 && <DropdownMenuSeparator />}
                  {group.map((sort) => (
                    <DropdownMenuRadioItem key={sort} value={sort}>
                      {t(`journal.sort.${sort.replace("-", ".")}`)}
                    </DropdownMenuRadioItem>
                  ))}
                </Fragment>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {journal.items.some((item) => item.type === "folder") && (
          <IconButton
            label={t(
              journal.expanded.size > 0
                ? "journal.collapseAll"
                : "journal.expandAll",
            )}
            onClick={() => journal.setAllExpanded(journal.expanded.size === 0)}
          >
            {journal.expanded.size > 0 ? (
              <ChevronsDownUp />
            ) : (
              <ChevronsUpDown />
            )}
          </IconButton>
        )}
        <IconButton
          variant={searchOpen ? "secondary" : "ghost"}
          label={t("journal.search")}
          aria-pressed={searchOpen}
          onClick={() => {
            setSearchOpen(!searchOpen);
            setQuery("");
          }}
        >
          <Search />
        </IconButton>
      </div>

      {searchOpen && (
        <div className="relative mt-2 flex items-center">
          <Input
            className="pe-8"
            placeholder={t("journal.searchPlaceholder")}
            aria-label={t("journal.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {searching && (
            <IconButton
              label={t("journal.clearSearch")}
              size="icon-sm"
              className="text-muted-foreground absolute inset-e-0"
              onClick={() => setQuery("")}
            >
              <X className="size-4" />
            </IconButton>
          )}
        </div>
      )}
    </>
  );
});
