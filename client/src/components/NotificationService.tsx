import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useApi } from "@/context/ApiContext";
import { useEventList } from "@/context/CalendarContext";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { useStorage } from "@/context/StorageContext";
import { useUser } from "@/context/UserContext";
import {
  isSoundBlocked,
  playNotificationSound,
  upcomingNotifications,
} from "@/lib/calendar/notifications";
import { createSerialQueue } from "@/lib/serialQueue";
import { isSubscriptionMissing } from "@/lib/subscription";

const REFRESH_MS = 60 * 60 * 1000;
const RETRY_MS = 10 * 1000;
const MAX_LATE_MS = 60 * 1000;

type PushTime = { at: number; device: boolean };

export default function NotificationService() {
  const { t } = useTranslation();
  const events = useEventList();
  const { user } = useUser();
  const { post, serverMeta } = useApi();
  const storage = useStorage();
  const settings = useCalendarSettings((s) => ({
    sound: s.notificationSound,
    volume: s.notificationVolume,
  }));
  const [refresh, setRefresh] = useState(0);
  const [uploadQueue] = useState(createSerialQueue);
  const uploaded = useRef(new Map<string, string>());
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const due = useMemo(
    () => upcomingNotifications(events, DateTime.now()),
    // eslint-disable-next-line
    [events, refresh],
  );

  const pushSubscription = storage.get("pushSubscription");
  const endpoint = useMemo<string | undefined>(
    () =>
      pushSubscription ? JSON.parse(pushSubscription).endpoint : undefined,
    [pushSubscription],
  );
  const pushActive =
    user?.type === "online" && !isSubscriptionMissing(user, serverMeta);

  useEffect(() => {
    const id = setInterval(() => setRefresh((n) => n + 1), REFRESH_MS);
    return () => {
      clearInterval(id);
      clearTimeout(retryTimer.current);
    };
  }, []);

  const hasSound = due.some((n) => n.method === "sound");

  useEffect(() => {
    if (!hasSound) return;
    let cancelled = false;
    let id: string | number | undefined;
    const dismiss = () => toast.dismiss(id);
    void isSoundBlocked()
      .catch(() => false)
      .then((blocked) => {
        if (!blocked || cancelled) return;
        id = toast.warning(t("notify.soundBlocked"), {
          position: "top-right",
          duration: Infinity,
          className: "border-warning! text-warning!"
        });
        window.addEventListener("pointerdown", dismiss, { once: true });
        window.addEventListener("keydown", dismiss, { once: true });
      });
    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismiss);
      dismiss();
    };
  }, [hasSound, t]);

  useEffect(() => {
    const timers = due
      .filter((n) => n.method === "sound")
      .map(({ at }) =>
        setTimeout(() => {
          if (Date.now() - at < MAX_LATE_MS)
            void playNotificationSound(settings.sound, settings.volume);
        }, at - Date.now()),
      );
    return () => timers.forEach(clearTimeout);
  }, [due, settings.sound, settings.volume]);

  useEffect(() => {
    if (!pushActive) return;

    const byEvent = new Map<string, PushTime[]>();
    for (const { eventId, at, method } of due) {
      if (method === "sound" || (method === "device" && !endpoint)) continue;
      const times = byEvent.get(eventId) ?? [];
      times.push({ at, device: method === "device" });
      byEvent.set(eventId, times);
    }

    const present = new Set(events.map((e) => e.id));
    for (const id of uploaded.current.keys()) {
      if (!byEvent.has(id) && present.has(id)) byEvent.set(id, []);
    }

    const signature = (times: PushTime[]) => JSON.stringify([endpoint, times]);
    const hasDeviceTimes = (times: PushTime[]) => times.some((t) => t.device);
    const uploadedTimes = (id: string): PushTime[] =>
      JSON.parse(uploaded.current.get(id) ?? "[null,[]]")[1];
    const remote = new Set(events.filter((e) => e._remote).map((e) => e.id));

    const changed: { id: string; times: PushTime[] }[] = [];
    for (const [id, times] of byEvent) {
      if (uploaded.current.get(id) === signature(times)) continue;

      const sharedOnly =
        !hasDeviceTimes(times) && !hasDeviceTimes(uploadedTimes(id));
      if (remote.has(id) && sharedOnly) {
        if (times.length) uploaded.current.set(id, signature(times));
        else uploaded.current.delete(id);
      } else {
        changed.push({ id, times });
      }
    }
    if (!changed.length) return;

    let superseded = false;
    void uploadQueue(async () => {
      if (superseded) return;
      const res = await post<{ retry: string[] }>(
        "calendar/notifications/sync",
        { endpoint: endpoint ?? "", events: changed },
      );
      if (!res.success) return;

      const retry = new Set(res.data?.retry);
      for (const { id, times } of changed) {
        if (retry.has(id)) continue;
        if (times.length) uploaded.current.set(id, signature(times));
        else uploaded.current.delete(id);
      }
      if (retry.size) {
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(
          () => setRefresh((n) => n + 1),
          RETRY_MS,
        );
      }
    });
    return () => {
      superseded = true;
    };
  }, [due, events, endpoint, pushActive, post, uploadQueue]);

  return null;
}
