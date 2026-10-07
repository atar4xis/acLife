import type { CalendarEvent } from "@/types/calendar/Event";
import type { ViewMode } from "@/types/calendar/ViewMode";
import { useCallback, useEffect, useState } from "react";
import AppCalendar from "@/components/calendar/Calendar";
import AppSidebar from "@/components/Sidebar";
import { useStorage } from "@/context/StorageContext";
import { useUser } from "@/context/UserContext";
import { useCalendarActions } from "@/context/CalendarContext";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { Spinner } from "./ui/spinner";
import { useCalendarEvents } from "@/hooks/calendar/useCalendarEvents";
import { emitStream, isOwnMessage, onStream } from "@/lib/stream";
import { useApi } from "@/context/ApiContext";
import UnlockDialog from "./login/UnlockDialog";
import SubscriptionDialog from "./subscription/SubscriptionDialog";
import { toast } from "sonner";
import PushService from "./PushService";
import StreamService from "./StreamService";
import NotificationService from "./NotificationService";
import AutoLockService from "./AutoLockService";
import SettingsDialog from "./settings/SettingsDialog";
import TimezoneChangeDialog from "./calendar/TimezoneChangeDialog";
import { isSubscriptionMissing } from "@/lib/subscription";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import { useTranslation } from "react-i18next";
import { t as translate } from "@/i18n";

export default function AppShell() {
  useSettingsSync();
  const settings = useCalendarSettings((s) => ({
    defaultView: s.defaultView,
    defaultTimezone: s.defaultTimezone,
  }));
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>(
    window.innerWidth < 768 ? "day" : settings.defaultView,
  );
  const [calEvents, setCalEvents] = useState<CalendarEvent[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<string | undefined>(
    undefined,
  );
  const { masterKey, bucketKey, user } = useUser();
  const { dispatch, pendingChanges, setCurrentDate, getCurrentDate } =
    useCalendarActions();
  const { serverMeta } = useApi();
  const storage = useStorage();
  const {
    saving,
    loadEvents,
    saveEvents,
    syncEvents,
    syncBuckets,
    applyChanges,
  } = useCalendarEvents(user, masterKey, bucketKey);

  const subscriptionMissing = isSubscriptionMissing(user, serverMeta);

  const openSettings = useCallback((categoryId?: string) => {
    setSettingsCategory(categoryId);
    setSettingsOpen(true);
  }, []);

  // load calendar events
  useEffect(() => {
    if (!user) return;
    if (masterKey === null) return;
    if (user.type === "online" && bucketKey === null) return;
    if (subscriptionMissing) return;

    const id = "loading-calendar-events";
    const timer = setTimeout(
      () => toast.loading(translate("appShell.loadingEvents"), { id }),
      300,
    );

    (async () => {
      try {
        setCalEvents(
          await loadEvents(user, masterKey, bucketKey, getCurrentDate()),
        );
        toast.dismiss(id);
      } catch {
        toast.error(translate("appShell.loadEventsFailed"), { id });
      } finally {
        clearTimeout(timer);
      }
    })();

    // eslint-disable-next-line
  }, [user, masterKey, bucketKey, subscriptionMissing]);

  // cache every save and show those from other devices, pull everything if that fails
  useEffect(() => {
    if (!masterKey || user?.type !== "online") return;

    let current = true;
    const stopListening = onStream("calendar", (event) => {
      applyChanges(event.changes ?? [], masterKey)
        .then((events) => {
          if (!current || isOwnMessage(event)) return;

          const changes = event.changes ?? [];
          const deletedIds = changes
            .filter((c) => c.type === "deleted")
            .map((c) => c.id);
          const upsertedIds = new Set(
            changes.filter((c) => c.type !== "deleted").map((c) => c.id),
          );
          dispatch({
            type: "merge",
            events: events.filter(
              (ev) =>
                upsertedIds.has(ev.id) &&
                pendingChanges.get(ev.id)?.at(-1)?.type !== "deleted",
            ),
            deletedIds,
          });
        })
        .catch(() => {
          if (current) emitStream({ type: "sync" });
        });
    });

    return () => {
      current = false;
      stopListening();
    };
  }, [masterKey, user?.type, applyChanges, dispatch, pendingChanges]);

  // re-zone the visible date so day/week boundaries follow the new default
  useEffect(() => {
    setCurrentDate((date) => date.setZone(settings.defaultTimezone));

    // eslint-disable-next-line
  }, [settings.defaultTimezone]);

  // wipe decrypted events from memory as soon as the data locks
  useEffect(() => {
    if (masterKey === null) setCalEvents(null);
  }, [masterKey]);

  // show offline when network goes offline
  useEffect(() => {
    const online = () => {
      setOffline(false);
    };
    const offline = () => {
      setOffline(true);
    };

    window.addEventListener("offline", offline);
    window.addEventListener("online", online);

    setOffline(!navigator.onLine);

    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  if (!storage || !user) return null;

  if (subscriptionMissing) {
    return <SubscriptionDialog />;
  }

  if (user.type === "online" && masterKey === null) {
    return <UnlockDialog />;
  }

  return (
    <>
      <AppSidebar onOpenSettings={openSettings} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        offlineUser={user.type === "offline"}
        subscriptionEnabled={!!serverMeta?.registration.subscriptionRequired}
        initialCategoryId={settingsCategory}
      />
      {user.type === "online" && offline && (
        <div className="fixed z-50 top-0 left-0 p-1 right-0 text-center bg-destructive text-background font-semibold">
          {t("appShell.offline")}
        </div>
      )}
      {saving && (
        <Spinner className="fixed bottom-5 inset-e-5 z-30 size-8 in-data-has-undo-buttons:inset-e-32" />
      )}
      <PushService />
      <StreamService />
      <NotificationService />
      <AutoLockService />
      <TimezoneChangeDialog />
      {calEvents !== null && (
        <AppCalendar
          events={calEvents}
          mode={viewMode}
          setMode={setViewMode}
          saveEvents={saveEvents}
          syncEvents={syncEvents}
          syncBuckets={syncBuckets}
        />
      )}
    </>
  );
}
