import { cn } from "@/lib/utils";

function Progress({
  value,
  indicatorClassName,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  value: number;
  indicatorClassName?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className={cn(
        "bg-muted h-2 w-full overflow-hidden rounded-full",
        className,
      )}
      {...props}
    >
      <div
        className={cn("bg-primary h-full", indicatorClassName)}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

export { Progress };
