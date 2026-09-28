import { useEffect, useState } from "react";
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
  const { timezones, lastSeenDeviceTimezone, setSetting } = useCalendarSettings(
    (s) => ({
      timezones: s.timezones,
      lastSeenDeviceTimezone: s.lastSeenDeviceTimezone,
      setSetting: s.setSetting,
    }),
  );
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const current = getDeviceTimezone();
    if (current !== lastSeenDeviceTimezone) setDetectedTimezone(current);

    // only check once, on mount
    // eslint-disable-next-line
  }, []);

  const dismiss = () => {
    if (detectedTimezone) setSetting("lastSeenDeviceTimezone", detectedTimezone);
    setDetectedTimezone(null);
  };

  const applyTimezone = () => {
    if (!detectedTimezone) return;
    setSetting("defaultTimezone", detectedTimezone);
    setSetting("timezones", [
      detectedTimezone,
      ...timezones.filter((tz) => tz !== detectedTimezone),
    ]);
    toast.success(`Time zone set to ${getFriendlyName(detectedTimezone)}`);
    dismiss();
  };

  return (
    <AlertDialog open={detectedTimezone !== null}>
      <AlertDialogContent>
        <AlertDialogTitle>Device time zone changed</AlertDialogTitle>
        <AlertDialogDescription>
          Your device's time zone changed to{" "}
          <strong>{detectedTimezone?.replace(/_/g, " ")}</strong>. Would you
          like to set this as your calendar's default time zone?
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={dismiss}>Keep current</AlertDialogCancel>
          <AlertDialogAction onClick={applyTimezone}>
            Set as default
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
