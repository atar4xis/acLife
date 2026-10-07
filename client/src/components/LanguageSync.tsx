import { useEffect } from "react";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { useTranslation } from "react-i18next";
import { applyFormats, applyLanguage, LOCALE_CACHE, LOCALE_KEY } from "@/i18n";

export default function LanguageSync() {
  const { i18n } = useTranslation();
  const language = useCalendarSettings((s) => s.language);
  const timeFormat = useCalendarSettings((s) => s.timeFormat);
  const dateFormat = useCalendarSettings((s) => s.dateFormat);
  const dateTimeFormat = useCalendarSettings((s) => s.dateTimeFormat);

  useEffect(() => applyLanguage(language), [language]);
  useEffect(() => {
    if (!("caches" in window)) return;
    void caches
      .open(LOCALE_CACHE)
      .then((cache) =>
        cache.put(
          LOCALE_KEY,
          new Response(
            JSON.stringify(
              i18n.getResourceBundle(i18n.language, "translation"),
            ),
          ),
        ),
      )
      .catch(() => {});
  }, [i18n, i18n.language]);
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
