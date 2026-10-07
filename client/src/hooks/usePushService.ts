import { useCallback } from "react";
import { useApi } from "@/context/ApiContext";
import { useStorage } from "@/context/StorageContext";
import {
  arrayBufferToBase64Url,
  browserSupportsPush,
  sameBytes,
  uint8ArrayFromUrlSafeBase64,
} from "@/lib/utils";
import { t } from "@/i18n";
import { toast } from "sonner";

export function usePushService() {
  const { get, set } = useStorage();
  const { serverMeta, post } = useApi();

  const supported = browserSupportsPush() && !!serverMeta?.vapidPublicKey;
  const enabled = !!get("pushSubscription");

  const enable = useCallback(async () => {
    if (!serverMeta?.vapidPublicKey) throw t("push.unavailable");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw t("push.permissionDenied");
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
      throw t("push.error");
    }

    const p256dh = arrayBufferToBase64Url(p256dhBuf);
    const auth = arrayBufferToBase64Url(authBuf);

    const res = await post("user/push/subscribe", { endpoint, p256dh, auth });
    if (!res.success) {
      throw t("push.errorLater");
    }

    set("pushSubscription", JSON.stringify(sub));
  }, [serverMeta, post, set]);

  const disable = useCallback(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();

    if (sub) {
      await post("user/push/unsubscribe", { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }

    set("pushSubscription", null);
  }, [set, post]);

  const verify = useCallback(async () => {
    const stored = get("pushSubscription");
    if (!stored) return;

    let sub: PushSubscription | null | undefined;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      sub = await reg?.pushManager.getSubscription();
    } catch {
      return;
    }

    const key = sub?.options.applicationServerKey;
    const valid =
      !!sub &&
      sub.endpoint === JSON.parse(stored).endpoint &&
      !(sub.expirationTime && sub.expirationTime <= Date.now()) &&
      (!key ||
        !serverMeta?.vapidPublicKey ||
        sameBytes(
          new Uint8Array(key),
          uint8ArrayFromUrlSafeBase64(serverMeta.vapidPublicKey),
        ));

    if (valid && sub) {
      const res = await post<{ known: boolean }>("user/push/check", {
        endpoint: sub.endpoint,
      });
      if (!res.success || res.data?.known) return;
    }

    try {
      await enable();
    } catch {
      await disable();
      toast.error(t("push.invalid"));
    }
  }, [get, serverMeta, post, enable, disable]);

  return { supported, enabled, enable, disable, verify };
}
