import type { CalendarEvent } from "@/types/calendar/Event";
import type { ViewMode } from "@/types/calendar/ViewMode";
import { useEffect, useState } from "react";
import AppCalendar from "@/components/calendar/Calendar";
import AppSidebar from "@/components/Sidebar";
import { useStorage } from "@/context/StorageContext";
import { useUser } from "@/context/UserContext";
import { useCalendar } from "@/context/CalendarContext";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { Spinner } from "./ui/spinner";
import { useCalendarEvents } from "@/hooks/calendar/useCalendarEvents";
import { useApi } from "@/context/ApiContext";
import UnlockDialog from "./login/UnlockDialog";
import SubscriptionDialog from "./subscription/SubscriptionDialog";
import { toast } from "sonner";
import PushService from "./PushService";
import AutoLockService from "./AutoLockService";
import SettingsDialog from "./settings/SettingsDialog";
import TimezoneChangeDialog from "./calendar/TimezoneChangeDialog";
import { isSubscriptionMissing } from "@/lib/subscription";
import { useSettingsSync } from "@/hooks/useSettingsSync";

export default function AppShell() {
  useSettingsSync();
  const { defaultView } = useCalendarSettings((s) => ({
    defaultView: s.defaultView,
  }));
  const [viewMode, setViewMode] = useState<ViewMode>(
    window.innerWidth < 768 ? "day" : defaultView,
  );
  const [calEvents, setCalEvents] = useState<CalendarEvent[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<string | undefined>(
    undefined,
  );
  const { masterKey, bucketKey, user } = useUser();
  const { currentDate, setCurrentDate } = useCalendar();
  const { defaultTimezone } = useCalendarSettings((s) => ({
    defaultTimezone: s.defaultTimezone,
  }));
  const { serverMeta } = useApi();
  const storage = useStorage();
  const { saving, loadEvents, saveEvents, syncEvents, syncBuckets } =
    useCalendarEvents(user, masterKey, bucketKey);

  const subscriptionMissing = isSubscriptionMissing(user, serverMeta);

  // load calendar events
  useEffect(() => {
    if (!user) return;
    if (masterKey === null) return;
    if (user.type === "online" && bucketKey === null) return;
    if (subscriptionMissing) return;

    toast.promise(
      (async () => {
        const events = await loadEvents(
          user,
          masterKey,
          bucketKey,
          currentDate,
        );
        setCalEvents(events);
      })(),
      {
        id: "loading-calendar-events",
        loading: "Loading calendar events...",
        error: "Failed to load calendar events.",
      },
    );

    // eslint-disable-next-line
  }, [user, masterKey, bucketKey, subscriptionMissing]);

  // re-zone the visible date so day/week boundaries follow the new default
  useEffect(() => {
    setCurrentDate(currentDate.setZone(defaultTimezone));

    // eslint-disable-next-line
  }, [defaultTimezone]);

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
      <AppSidebar
        onOpenSettings={(categoryId) => {
          setSettingsCategory(categoryId);
          setSettingsOpen(true);
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        offlineUser={user.type === "offline"}
        subscriptionEnabled={!!serverMeta?.registration.subscriptionRequired}
        initialCategoryId={settingsCategory}
      />
      {user.type === "online" && offline && (
        <div className="fixed z-50 top-0 left-0 p-1 right-0 text-center bg-destructive text-background font-semibold">
          You are offline. Check your connection.
        </div>
      )}
      {saving && <Spinner className="fixed bottom-5 right-5 size-8" />}
      <PushService />
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
