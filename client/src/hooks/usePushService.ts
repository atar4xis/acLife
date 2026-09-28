import { useCallback } from "react";
import { useApi } from "@/context/ApiContext";
import { useStorage } from "@/context/StorageContext";
import {
  arrayBufferToBase64Url,
  browserSupportsPush,
  uint8ArrayFromUrlSafeBase64,
} from "@/lib/utils";

export function usePushService() {
  const storage = useStorage();
  const { serverMeta, post } = useApi();

  const supported = browserSupportsPush() && !!serverMeta?.vapidPublicKey;
  const enabled = !!storage.get("pushSubscription");

  const enable = useCallback(async () => {
    if (!serverMeta?.vapidPublicKey) throw "Push service is not available.";

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

    const res = await post("user/push/subscribe", { endpoint, p256dh, auth });
    if (!res.success) {
      throw "Something went wrong. Please try again later.";
    }

    storage.set("pushSubscription", JSON.stringify(sub));
  }, [serverMeta, post, storage]);

  const disable = useCallback(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();

    if (sub) {
      await post("user/push/unsubscribe", { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }

    storage.set("pushSubscription", null);
  }, [storage, post]);

  return { supported, enabled, enable, disable };
}
