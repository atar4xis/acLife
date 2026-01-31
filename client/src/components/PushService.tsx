import { useApi } from "@/context/ApiContext";
import YesNoDialog from "./dialog/YesNoDialog";
import { useCallback, useEffect, useState } from "react";
import { useStorage } from "@/context/StorageContext";
import {
  arrayBufferToBase64Url,
  browserSupportsPush,
  uint8ArrayFromUrlSafeBase64,
} from "@/lib/utils";
import { toast } from "sonner";
import { useUser } from "@/context/UserContext";

export default function PushService() {
  const storage = useStorage();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { serverMeta, post } = useApi();
  const { user } = useUser();

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
    if (!storage || !serverMeta?.vapidPublicKey) return;

    const tryEnable = async () => {
      setLoading(true);
      toast.promise(
        (async () => {
          const permission = await Notification.requestPermission();

          if (permission !== "granted") {
            throw "Notification permission request denied.";
          }

          const sw = await navigator.serviceWorker.register("/acLife/sw.js", {
            scope: "/acLife/",
          });

          if (!navigator.serviceWorker.controller) {
            await new Promise<void>((resolve) => {
              navigator.serviceWorker.addEventListener(
                "controllerchange",
                () => resolve(),
                { once: true },
              );
            });
          }

          const existing = await sw.pushManager.getSubscription();
          if (existing) await existing.unsubscribe();

          const sub = await sw.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: uint8ArrayFromUrlSafeBase64(
              serverMeta.vapidPublicKey,
            ),
          });

          const endpoint = sub.endpoint;

          const p256dhBuf = sub.getKey("p256dh");
          const authBuf = sub.getKey("auth");

          if (!p256dhBuf || !authBuf) {
            await sub.unsubscribe();
            throw "Something went wrong. Please try again.";
          }

          const p256dh = arrayBufferToBase64Url(p256dhBuf);
          const auth = arrayBufferToBase64Url(authBuf);

          const res = await post("user/push/subscribe", {
            endpoint,
            p256dh,
            auth,
          });

          if (!res.success) {
            throw "Something went wrong. Please try again later.";
          }

          storage.set("pushSubscription", JSON.stringify(sub));
        })(),
        {
          loading: "Setting up push service...",
          success: () => {
            setOpen(false);
            return "Push service enabled.";
          },
          error: (d) => {
            setLoading(false);
            return d;
          },
        },
      );
    };

    tryEnable();
  }, [storage, serverMeta, post]);

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
