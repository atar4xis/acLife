import { useApi } from "@/context/ApiContext";
import YesNoDialog from "./dialog/YesNoDialog";
import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { useStorage } from "@/context/StorageContext";
import { browserSupportsPush } from "@/lib/utils";
import { toast } from "sonner";
import { useUser } from "@/context/UserContext";
import { usePushService } from "@/hooks/usePushService";
import { useTranslation } from "react-i18next";

const VERIFY_MS = 60 * 60 * 1000;

export default function PushService() {
  const storage = useStorage();

  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { serverMeta } = useApi();
  const { user } = useUser();
  const { enable, enabled, verify } = usePushService();

  // ask to enable push if not yet enabled
  useEffect(() => {
    const pushKey = storage?.get("pushSubscription");
    const pushDismissed = storage?.get("pushDismissed");

    if (
      browserSupportsPush() &&
      !pushKey &&
      !pushDismissed &&
      user &&
      user.type === "online" &&
      serverMeta?.vapidPublicKey
    ) {
      setOpen(true);
      return;
    }
  }, [storage, serverMeta, user]);

  // keep the service worker up to date
  useEffect(() => {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg) reg.update();
    });
  }, []);

  const runVerify = useEffectEvent(verify);
  const online = user?.type === "online";
  useEffect(() => {
    if (!enabled || !online) return;

    runVerify();
    const id = setInterval(runVerify, VERIFY_MS);
    window.addEventListener("online", runVerify);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", runVerify);
    };
  }, [enabled, online]);

  const handleDismissPushService = useCallback(() => {
    if (!storage) return;

    storage.set("pushDismissed", true);
    toast.message(t("push.later"));
    setOpen(false);
  }, [storage, t]);

  const handleEnablePushService = useCallback(() => {
    setLoading(true);
    toast.promise(enable(), {
      loading: t("push.settingUp"),
      success: () => {
        setOpen(false);
        return t("push.enabled");
      },
      error: (d) => {
        setLoading(false);
        return d;
      },
    });
  }, [enable, t]);

  return (
    <YesNoDialog
      open={open}
      disabled={loading}
      title={t("push.title")}
      yesText={t("push.yes")}
      noText={t("push.no")}
      cancelText={t("push.cancel")}
      onYes={handleEnablePushService}
      onNo={handleDismissPushService}
      onCancel={() => {
        setOpen(false);
      }}
    >
      <p>{t("push.description")}</p>
    </YesNoDialog>
  );
}
