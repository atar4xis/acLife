import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";

export default function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="size-6 text-muted-foreground"
      aria-label={t("journal.copyCode")}
      title={t("journal.copyCode")}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1000);
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  );
}
