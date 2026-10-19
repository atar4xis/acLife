import { Button } from "@/components/ui/button";
import { useFingerprint } from "@/hooks/useFingerprint";
import { cn } from "@/lib/utils";
import type { Trust } from "@/types/Share";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function FingerprintStep({
  email,
  publicKey,
  trust,
  continueLabel,
  busy,
  onContinue,
  onCancel,
}: {
  email: string;
  publicKey: string;
  trust: Trust;
  continueLabel: string;
  busy?: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const code = useFingerprint(publicKey);
  const changed = trust === "changed";

  return (
    <div className="flex flex-col gap-4">
      {changed ? (
        <div
          role="alert"
          className="border-warning text-warning flex items-start gap-2 rounded-md border p-3 text-sm font-medium"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {t("shares.codeChanged", { email })}
        </div>
      ) : (
        <p className="text-sm">{t("shares.codeIntro", { email })}</p>
      )}
      <p
        className={cn(
          "bg-muted rounded-md border border-transparent p-3 text-center font-mono text-lg tracking-wide",
          changed && "border-warning",
        )}
        dir="ltr"
        aria-label={t("shares.codeLabel", { email })}
      >
        {code || " "}
      </p>
      <p className="text-muted-foreground text-xs">
        {t(changed ? "shares.codeChangedHint" : "shares.codeHint")}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button
          variant={changed ? "destructive" : "default"}
          onClick={onContinue}
          disabled={busy || !code}
        >
          {continueLabel}
        </Button>
      </div>
    </div>
  );
}
