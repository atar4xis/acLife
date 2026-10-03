import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useApi } from "@/context/ApiContext";
import { useEffect, useState } from "react";
import { Trans } from "react-i18next";
import { useTranslation } from "react-i18next";

export const RESEND_COOLDOWN_SECONDS = 60;

export function EmailVerificationRequired({
  email,
  onBack,
  initialCooldown = 0,
}: {
  email: string;
  onBack: () => void;
  initialCooldown?: number;
}) {
  const { post } = useApi();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(initialCooldown);

  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await post("auth/resend-verification", { email });

      if (res.success) {
        setSuccess(t("login.verificationSent"));
      } else {
        setError(res.message || t("login.resendFailed"));
      }

      setCooldown(RESEND_COOLDOWN_SECONDS);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 text-center">
      <Card className="bg-transparent border-none shadow-none">
        <CardTitle>{t("login.verificationRequired")}</CardTitle>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm mb-4">
            <Trans
              i18nKey="login.verificationLinkSent"
              values={{ email }}
              components={{ strong: <strong /> }}
            />
          </p>
          <Button onClick={handleResend} disabled={loading || cooldown > 0}>
            {loading ? (
              <Spinner />
            ) : cooldown > 0 ? (
              t("login.resendCooldown", { seconds: cooldown })
            ) : (
              t("login.resend")
            )}
          </Button>
          {error && <span className="text-sm text-destructive">{error}</span>}
          {success && !error && (
            <span className="text-sm text-success">{success}</span>
          )}
          <Button variant="outline" onClick={onBack}>
            {t("login.backToLogin")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
