import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LucideIcon } from "@/components/ui/lucide-icon";
import { useIconMap } from "@/hooks/useIconMap";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import ScrollThumb from "@/components/ui/scroll-thumb";
import { tokenize } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const COLUMNS = 6;
const GAP = 8;
const ROW_HEIGHT = 40 + GAP;
const VIEWPORT_HEIGHT = 256;
const OVERSCAN_ROWS = 2;

function IconGrid({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const deferredQuery = useDeferredValue(query);
  const icons = useIconMap();
  const names = useMemo(() => Object.keys(icons ?? {}), [icons]);

  const tokens = tokenize(deferredQuery);
  const results = names.filter((name) =>
    tokens.every((token) => name.toLowerCase().includes(token)),
  );
  const firstRow = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS,
  );
  const endRow =
    Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN_ROWS;
  const visible = results.slice(firstRow * COLUMNS, endRow * COLUMNS);

  return (
    <>
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setScrollTop(0);
          scroller.current?.scrollTo({ top: 0 });
        }}
        placeholder={t("iconPicker.search")}
        aria-label={t("iconPicker.search")}
      />
      <div className="relative mt-3">
        <div
          ref={scroller}
          className="hide-scrollbar overflow-x-hidden overflow-y-auto"
          style={{ maxHeight: VIEWPORT_HEIGHT }}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          {icons && results.length === 0 ? (
            <p className="text-muted-foreground text-center text-sm">
              {t("iconPicker.empty")}
            </p>
          ) : (
            <div
              className="relative"
              style={{
                height: Math.ceil(results.length / COLUMNS) * ROW_HEIGHT,
              }}
            >
              <div
                className="absolute inset-x-0 grid grid-cols-6"
                style={{
                  top: firstRow * ROW_HEIGHT,
                  gap: GAP,
                  gridAutoRows: ROW_HEIGHT - GAP,
                }}
              >
                {visible.map((name) => (
                  <Button
                    key={name}
                    type="button"
                    variant={name === value ? "secondary" : "ghost"}
                    size="icon-lg"
                    className="size-full"
                    title={name}
                    aria-label={name}
                    onClick={() => onChange(name)}
                  >
                    <LucideIcon name={name} className="size-5" />
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
        <ScrollThumb gridRef={scroller} />
      </div>
    </>
  );
}

export function IconPicker({
  value,
  onChange,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={className}
          {...props}
        >
          <LucideIcon name={value} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <IconGrid
          value={value}
          onChange={(name) => {
            onChange(name);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
