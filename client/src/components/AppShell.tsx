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

export default function AppShell() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [calEvents, setCalEvents] = useState<CalendarEvent[] | null>(null);
  const { masterKey, user } = useUser();
  const { serverMeta } = useApi();
  const storage = useStorage();
  const { saving, loadEvents, saveEvents } = useCalendarEvents(user, masterKey);

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

    let alive = true;

    loadEvents(user, masterKey).then((events) => {
      if (alive) setCalEvents(events);
    });

    return () => {
      alive = false;
    };
  }, [serverMeta, user, masterKey, activeSub, subRequired]);

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
      {saving && <Spinner className="fixed bottom-5 right-5 size-8" />}
      {calEvents !== null && (
        <AppCalendar
          events={calEvents}
          mode={viewMode}
          setMode={setViewMode}
          saveEvents={saveEvents}
        />
      )}
    </>
  );
}
