import { useApi } from "@/context/ApiContext";
import YesNoDialog from "./dialog/YesNoDialog";
import { useCallback, useEffect, useState } from "react";
import { useStorage } from "@/context/StorageContext";
import { browserSupportsPush } from "@/lib/utils";
import { toast } from "sonner";
import { useUser } from "@/context/UserContext";
import { usePushService } from "@/hooks/usePushService";

export default function PushService() {
  const storage = useStorage();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { serverMeta } = useApi();
  const { user } = useUser();
  const { enable } = usePushService();

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

  const handleDismissPushService = useCallback(() => {
    if (!storage) return;

    storage.set("pushDismissed", true);
    toast.message("You can enable the push service later in settings.");
    setOpen(false);
  }, [storage]);

  const handleEnablePushService = useCallback(() => {
    setLoading(true);
    toast.promise(enable(), {
      loading: "Setting up push service...",
      success: () => {
        setOpen(false);
        return "Push service enabled.";
      },
      error: (d) => {
        setLoading(false);
        return d;
      },
    });
  }, [enable]);

  return (
    <YesNoDialog
      open={open}
      disabled={loading}
      title="Push Service"
      yesText="Enable it"
      noText="Keep it off"
      cancelText="Remind me later"
      onYes={handleEnablePushService}
      onNo={handleDismissPushService}
      onCancel={() => {
        setOpen(false);
      }}
    >
      <p>
        Enabling the push service improves data sync between devices and allows
        push notifications to work.
      </p>
    </YesNoDialog>
  );
}
