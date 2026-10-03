import { useEffect } from "react";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { applyFormats, applyLanguage } from "@/i18n";

export default function LanguageSync() {
  const language = useCalendarSettings((s) => s.language);
  const timeFormat = useCalendarSettings((s) => s.timeFormat);
  const dateFormat = useCalendarSettings((s) => s.dateFormat);
  const dateTimeFormat = useCalendarSettings((s) => s.dateTimeFormat);

  useEffect(() => applyLanguage(language), [language]);
  useEffect(
    () =>
      applyFormats({
        time: timeFormat,
        date: dateFormat,
        dateTimeLong: dateTimeFormat,
      }),
    [timeFormat, dateFormat, dateTimeFormat],
  );

  return null;
}
