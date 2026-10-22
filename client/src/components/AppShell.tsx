import type { CalendarEvent } from "@/types/calendar/Event";
import type { ViewMode } from "@/types/calendar/ViewMode";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppCalendar from "@/components/calendar/Calendar";
import AppSidebar from "@/components/Sidebar";
import JournalView from "@/components/journal/JournalView";
import { useAppView } from "@/hooks/useAppView";
import { useStorage } from "@/context/StorageContext";
import { useUser } from "@/context/UserContext";
import { useJournalSaving } from "@/context/JournalContext";
import { useCalendarActions } from "@/context/CalendarContext";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { Spinner } from "./ui/spinner";
import { useCalendarEvents } from "@/hooks/calendar/useCalendarEvents";
import {
  withoutPendingDeletes,
  withPendingChanges,
} from "@/lib/calendar/pending";
import { emitStream, isOwnMessage, onStream } from "@/lib/stream";
import { useApi } from "@/context/ApiContext";
import { useShares } from "@/context/ShareContext";
import UnlockDialog from "./login/UnlockDialog";
import SubscriptionDialog from "./subscription/SubscriptionDialog";
import { toast } from "sonner";
import PushService from "./PushService";
import StreamService from "./StreamService";
import NotificationService from "./NotificationService";
import AutoLockService from "./AutoLockService";
import SettingsDialog from "./settings/SettingsDialog";
import InviteNotifier from "./sharing/InviteNotifier";
import ShareDialog from "./sharing/ShareDialog";
import TimezoneChangeDialog from "./calendar/TimezoneChangeDialog";
import {
  canManageSubscription,
  isSubscriptionMissing,
} from "@/lib/subscription";
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
    settings.defaultView === "default"
      ? window.innerWidth < 768
        ? "day"
        : "week"
      : settings.defaultView,
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
  const { joined, owned, loaded: sharesLoaded } = useShares();
  const storage = useStorage();
  const { view, changeView } = useAppView();
  const {
    saving,
    loadEvents,
    saveEvents,
    syncEvents,
    syncExpanded,
    applyChanges,
    applySharedChanges,
  } = useCalendarEvents(user, masterKey, bucketKey);

  const journalSaving = useJournalSaving();

  const subscriptionMissing = isSubscriptionMissing(user, serverMeta);

  const openSettings = useCallback((categoryId?: string) => {
    setSettingsCategory(categoryId);
    setSettingsOpen(true);
  }, []);

  // changes whenever the set of calendar shares or a permission does, so events reload
  const calendarSpaces = useMemo(
    () =>
      [
        ...joined
          .filter((space) => space.kind === "calendar")
          .map((space) => `${space.id}:${space.permission}`),
        ...owned
          .filter((space) => space.kind === "calendar")
          .map((space) => space.id),
      ]
        .toSorted()
        .join(";"),
    [joined, owned],
  );

  // load calendar events
  useEffect(() => {
    if (!user) return;
    if (masterKey === null) return;
    if (user.type === "online" && bucketKey === null) return;
    if (subscriptionMissing) return;
    if (!sharesLoaded) return;

    const id = "loading-calendar-events";
    const timer = setTimeout(
      () => toast.loading(translate("appShell.loadingEvents"), { id }),
      300,
    );

    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadEvents(
          user,
          masterKey,
          bucketKey,
          getCurrentDate(),
        );
        if (cancelled) return;

        setCalEvents(withPendingChanges(loaded, pendingChanges));
        toast.dismiss(id);
      } catch {
        if (!cancelled)
          toast.error(translate("appShell.loadEventsFailed"), { id });
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line
  }, [
    user,
    masterKey,
    bucketKey,
    subscriptionMissing,
    sharesLoaded,
    calendarSpaces,
  ]);

  // cache every save and show those from other devices, pull everything if that fails
  useEffect(() => {
    if (!masterKey || !bucketKey || user?.type !== "online") return;

    let cancelled = false;
    const stopListening = onStream("calendar", (event) => {
      applyChanges(event.changes ?? [], masterKey, bucketKey)
        .then((events) => {
          if (cancelled || isOwnMessage(event)) return;

          const changes = event.changes ?? [];
          const deletedIds = changes
            .filter((c) => c.type === "deleted")
            .map((c) => c.id);
          const upsertedIds = new Set(
            changes.filter((c) => c.type !== "deleted").map((c) => c.id),
          );
          dispatch({
            type: "merge",
            events: withoutPendingDeletes(
              events.filter((ev) => upsertedIds.has(ev.id)),
              pendingChanges,
            ),
            deletedIds,
          });
        })
        .catch(() => {
          if (!cancelled) emitStream({ type: "sync" });
        });
    });

    return () => {
      cancelled = true;
      stopListening();
    };
  }, [
    masterKey,
    bucketKey,
    user?.type,
    applyChanges,
    dispatch,
    pendingChanges,
  ]);

  useEffect(() => {
    if (!masterKey || !bucketKey || user?.type !== "online") return;

    let cancelled = false;
    const stopListening = onStream("space-updated", (event) => {
      if (!event.space) return;
      // too large to push, so fall back to a full sync
      if (!event.changes) {
        emitStream({ type: "sync" });
        return;
      }

      applySharedChanges(
        event.space,
        event.changes,
        isOwnMessage(event),
        masterKey,
        bucketKey,
      )
        .then(({ events, deletedIds }) => {
          if (cancelled || isOwnMessage(event)) return;

          dispatch({
            type: "merge",
            // a local delete not saved yet must not be undone by the incoming copy
            events: withoutPendingDeletes(events, pendingChanges),
            deletedIds,
          });
        })
        .catch(() => {
          if (!cancelled) emitStream({ type: "sync" });
        });
    });

    return () => {
      cancelled = true;
      stopListening();
    };
  }, [
    masterKey,
    bucketKey,
    user?.type,
    applySharedChanges,
    dispatch,
    pendingChanges,
  ]);

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
      <AppSidebar
        view={view}
        onChangeView={changeView}
        onOpenSettings={openSettings}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        offlineUser={user.type === "offline"}
        subscriptionEnabled={canManageSubscription(user, serverMeta)}
        initialCategoryId={settingsCategory}
      />
      {user.type === "online" && offline && (
        <div className="fixed z-50 top-0 left-0 p-1 right-0 text-center bg-destructive text-background font-semibold">
          {t("appShell.offline")}
        </div>
      )}
      {(saving || journalSaving) && (
        <Spinner className="fixed bottom-5 inset-e-5 z-30 max-md:z-10 size-8 in-data-has-undo-buttons:inset-e-32" />
      )}
      <PushService />
      <StreamService />
      <NotificationService />
      <AutoLockService />
      <TimezoneChangeDialog />
      <ShareDialog />
      <InviteNotifier onView={openSettings} />
      <div className={view === "calendar" ? "contents" : "hidden"}>
        {calEvents !== null && (
          <AppCalendar
            active={view === "calendar"}
            events={calEvents}
            mode={viewMode}
            setMode={setViewMode}
            saveEvents={saveEvents}
            syncEvents={syncEvents}
            syncExpanded={syncExpanded}
          />
        )}
      </div>
      {view === "journal" && <JournalView />}
    </>
  );
}
