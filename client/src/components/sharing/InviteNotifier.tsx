import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { useShares } from "@/context/ShareContext";
import { useStorage } from "@/context/StorageContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const INVITE_TOAST_MS = 15000;
const REMEMBERED_INVITES = 200;

export default function InviteNotifier({
  onView,
}: {
  onView: (category: string) => void;
}) {
  const { t } = useTranslation();
  const { invites, nameOf } = useShares();
  const { ready, get, set } = useStorage();
  const enabled = useCalendarSettings((s) => s.inviteNotifications);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!ready) return;

    // each invite is announced once, even when notifications are off
    const notified = get("notifiedInvites");
    const fresh = invites.filter((invite) => !notified.includes(invite.id));
    if (fresh.length === 0) return;

    set(
      "notifiedInvites",
      [...notified, ...fresh.map((invite) => invite.id)].slice(
        -REMEMBERED_INVITES,
      ),
    );
    if (!enabled) return;

    for (const invite of fresh) {
      toast.info(t("shares.newInvitation"), {
        id: `invite-${invite.id}`,
        description: t("shares.inviteToast", {
          email: nameOf(invite.owner, invite.ownerEmail),
          what: t(`shares.kind.${invite.kind}.${invite.scope}`),
        }),
        position: isMobile ? "top-center" : "top-left",
        duration: INVITE_TOAST_MS,
        action: {
          label: t("shares.viewInvite"),
          onClick: () => onView("sharing"),
        },
      });
    }
  }, [ready, invites, nameOf, enabled, isMobile, get, set, t, onView]);

  return null;
}
