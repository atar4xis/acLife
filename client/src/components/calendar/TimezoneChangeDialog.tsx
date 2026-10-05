import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { getDeviceTimezone, getFriendlyName } from "@/lib/calendar/timezone";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "../ui/alert-dialog";

export default function TimezoneChangeDialog() {
  const { t } = useTranslation();
  const settings = useCalendarSettings((s) => ({
    timezones: s.timezones,
    lastSeenDeviceTimezone: s.lastSeenDeviceTimezone,
    setSetting: s.setSetting,
  }));
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);

  useEffect(() => {
    const current = getDeviceTimezone();
    if (current !== settings.lastSeenDeviceTimezone)
      setDetectedTimezone(current);

    // only check once, on mount
    // eslint-disable-next-line
  }, []);

  const dismiss = () => {
    if (detectedTimezone)
      settings.setSetting("lastSeenDeviceTimezone", detectedTimezone);
    setDetectedTimezone(null);
  };

  const applyTimezone = () => {
    if (!detectedTimezone) return;
    settings.setSetting("defaultTimezone", detectedTimezone);
    settings.setSetting("timezones", [
      detectedTimezone,
      ...settings.timezones.filter((tz) => tz !== detectedTimezone),
    ]);
    toast.success(
      t("timezone.setTo", { name: getFriendlyName(detectedTimezone) }),
    );
    dismiss();
  };

  return (
    <AlertDialog open={detectedTimezone !== null}>
      <AlertDialogContent>
        <AlertDialogTitle>{t("timezone.changedTitle")}</AlertDialogTitle>
        <AlertDialogDescription>
          <Trans
            i18nKey="timezone.changedDescription"
            values={{ name: detectedTimezone?.replace(/_/g, " ") }}
            components={{ strong: <strong /> }}
          />
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={dismiss}>
            {t("timezone.keep")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={applyTimezone}>
            {t("timezone.setDefault")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
