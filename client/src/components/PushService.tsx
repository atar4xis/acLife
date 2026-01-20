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

export default function PushService() {
  const storage = useStorage();

  const [open, setOpen] = useState(false);
  const { serverMeta, post } = useApi();

  // ask to enable push if not yet enabled
  useEffect(() => {
    const pushKey = storage?.get("pushSubscription");
    const pushDismissed = storage?.get("pushDismissed");

    if (
      browserSupportsPush() &&
      !pushKey &&
      !pushDismissed &&
      serverMeta?.vapidPublicKey
    ) {
      setOpen(true);
      return;
    }
  }, [storage, serverMeta]);

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
      toast.promise(
        new Promise(async (resolve, reject) => {
          const permission = await Notification.requestPermission();

          if (permission !== "granted") {
            reject("Notification permission request denied.");
            return;
          }

          const sw = await navigator.serviceWorker.register("/acLife/sw.js", {
            scope: "/acLife/",
          });

          if (!navigator.serviceWorker.controller) {
            await new Promise<void>((resolve) => {
              navigator.serviceWorker.addEventListener(
                "controllerchange",
                () => {
                  resolve();
                },
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
            reject("Something went wrong. Please try again.");
            return;
          }

          const p256dh = arrayBufferToBase64Url(p256dhBuf);
          const auth = arrayBufferToBase64Url(authBuf);

          const res = await post("user/push/subscribe", {
            endpoint,
            p256dh,
            auth,
          });

          if (!res.success) {
            reject("Something went wrong. Please try again later.");
            return;
          }

          storage.set("pushSubscription", JSON.stringify(sub));
          resolve("ok");
        }),
        {
          loading: "Setting up push service...",
          success: () => {
            setOpen(false);
            return "Push service enabled.";
          },
          error: (d) => d,
        },
      );
    };

    tryEnable();
  }, [storage, serverMeta]);

  return (
    <YesNoDialog
      open={open}
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
