import ScrollThumb from "@/components/ui/scroll-thumb";
import { cn } from "@/lib/utils";
import { useImperativeHandle, useRef, type ComponentProps } from "react";

export default function ScrollContainer({
  ref,
  className,
  wrapperClassName,
  ...props
}: ComponentProps<"div"> & { wrapperClassName?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => scroller.current!);

  return (
    <div className={cn("relative flex min-h-0 flex-col", wrapperClassName)}>
      <div
        ref={scroller}
        data-slot="scroll-container"
        className={cn("hide-scrollbar min-h-0 overflow-auto", className)}
        {...props}
      />
      <ScrollThumb gridRef={scroller} />
      <ScrollThumb gridRef={scroller} axis="x" />
    </div>
  );
}
