import type { CalendarEvent } from "@/types/calendar/Event";
import type { ViewMode } from "@/types/calendar/ViewMode";
import { useEffect, useState } from "react";
import AppCalendar from "@/components/calendar/Calendar";
import AppSidebar from "@/components/Sidebar";
import { useStorage } from "@/context/StorageContext";
import { useUser } from "@/context/UserContext";
import { Spinner } from "./ui/spinner";
import { useCalendarEvents } from "@/hooks/calendar/useCalendarEvents";
import { useApi } from "@/context/ApiContext";
import UnlockDialog from "./login/UnlockDialog";
import SubscriptionDialog from "./subscription/SubscriptionDialog";
import { toast } from "sonner";
import PushService from "./PushService";

export default function AppShell() {
  const [viewMode, setViewMode] = useState<ViewMode>(
    window.innerWidth < 768 ? "day" : "week",
  );
  const [calEvents, setCalEvents] = useState<CalendarEvent[] | null>(null);
  const [offline, setOffline] = useState(false);
  const { masterKey, user } = useUser();
  const { serverMeta } = useApi();
  const storage = useStorage();
  const { saving, loadEvents, saveEvents, syncEvents } = useCalendarEvents(
    user,
    masterKey,
  );

  const activeSub =
    user?.type === "online" &&
    ["active", "trialing"].includes(user.subscription_status || "");

  const subRequired =
    user?.type === "online" && serverMeta?.registration.subscriptionRequired;

  // load calendar events
  useEffect(() => {
    if (!serverMeta || !user) return;
    if (masterKey === null) return;
    if (!activeSub && subRequired) return;

    toast.promise(
      (async () => {
        const events = await loadEvents(user, masterKey);
        setCalEvents(events);
      })(),
      {
        id: "loading-calendar-events",
        loading: "Loading calendar events...",
        error: "Failed to load calendar events.",
      },
    );

    // eslint-disable-next-line
  }, [serverMeta, user, masterKey, activeSub, subRequired]);

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

  if (!storage || !user || !serverMeta) return null;

  if (masterKey === null) {
    return <UnlockDialog />;
  }

  if (!activeSub && subRequired) {
    return <SubscriptionDialog />;
  }
  return (
    <>
      <AppSidebar />
      {user.type === "online" && offline && (
        <div className="fixed z-50 top-0 left-0 p-1 right-0 text-center bg-red-500/75 dark:bg-red-700/75 text-white font-semibold">
          You are offline. Check your connection.
        </div>
      )}
      {saving && <Spinner className="fixed bottom-5 right-5 size-8" />}
      <PushService />
      {calEvents !== null && (
        <AppCalendar
          events={calEvents}
          mode={viewMode}
          setMode={setViewMode}
          saveEvents={saveEvents}
          syncEvents={syncEvents}
        />
      )}
    </>
  );
}
