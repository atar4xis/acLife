import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useApi } from "@/context/ApiContext";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export function ConfirmEmailPrompt({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const { post } = useApi();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);

    try {
      const res = await post("auth/verify-email", { token });

      if (res.success) {
        toast.success(t("login.emailVerified"));
      } else {
        toast.error(res.message || t("login.emailVerifyFailed"));
      }
    } finally {
      setLoading(false);
      onDone();
    }
  };

  return (
    <div className="flex flex-col gap-4 text-center">
      <p className="text-sm my-4">{t("login.verifyPrompt")}</p>
      <Button onClick={handleConfirm} disabled={loading}>
        {loading ? <Spinner /> : t("login.verifyEmail")}
      </Button>
      <Button variant="outline" onClick={onDone} disabled={loading}>
        {t("common.cancel")}
      </Button>
    </div>
  );
}
