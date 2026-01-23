import { cn } from "@/lib/utils";
import type { CellProps } from "@/types/calendar/Cell";
import { memo } from "react";

export default memo(function HeaderCell({ children, className }: CellProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-16 shadow-[inset_-1px_-1px_0_0_var(--foreground)]/10 flex items-center justify-center bg-background min-w-0",
        className,
      )}
    >
      <span className="truncate w-full text-center">{children}</span>
    </div>
  );
});
