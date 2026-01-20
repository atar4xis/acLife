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

    let alive = true;

    toast.promise<CalendarEvent[]>(loadEvents(user, masterKey), {
      loading: "Decrypting events...",
      success: (events: CalendarEvent[]) => {
        if (alive) setCalEvents(events);
        return `Loaded ${events.length} events.`;
      },
      error: "Failed to load events.",
    });

    return () => {
      alive = false;
    };
    // eslint-disable-next-line
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
