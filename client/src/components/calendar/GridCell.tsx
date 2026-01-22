import useTapInteraction from "@/hooks/useTapInteraction";
import { cn } from "@/lib/utils";
import type { CellProps } from "@/types/calendar/Cell";
import { memo } from "react";

export default memo(function GridCell({
  children,
  className,
  day,
  onCellTap,
  ...handlers
}: CellProps & {
  day: number;
  onCellTap: (e: React.PointerEvent, day: number) => void;
}) {
  const { handlers: tapHandlers } = useTapInteraction({
    onTap: (e) => onCellTap(e, day),
  });

  return (
    <div
      className={cn("relative shadow-[inset_-1px_-1px_0_0_var(--foreground)]/10", className)}
      data-day-index={day}
      {...handlers}
      {...tapHandlers}
    >
      {children}
    </div>
  );
});
