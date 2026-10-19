import { useFingerprint } from "@/hooks/useFingerprint";
import { cn } from "@/lib/utils";

export default function SecurityCode({
  publicKey,
  className,
}: {
  publicKey: string;
  className?: string;
}) {
  const code = useFingerprint(publicKey);

  return (
    <span className={cn("font-mono text-sm", className)} dir="ltr">
      {code}
    </span>
  );
}
