import { useEffect, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// mounts children after first paint, showing a skeleton until then
export default function DeferredContent({
  skeletonClassName,
  children,
}: {
  skeletonClassName: string;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!window.requestIdleCallback) {
      const timeout = setTimeout(() => setReady(true));
      return () => clearTimeout(timeout);
    }
    const handle = window.requestIdleCallback(() => setReady(true));
    return () => window.cancelIdleCallback(handle);
  }, []);

  return ready ? children : <Skeleton className={skeletonClassName} />;
}
