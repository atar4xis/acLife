import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { languageCodes, languageNames } from "@/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function LanguageSelect() {
  const { t } = useTranslation();
  const { language, setSetting } = useCalendarSettings((s) => ({
    language: s.language,
    setSetting: s.setSetting,
  }));

  return (
    <Select value={language} onValueChange={(v) => setSetting("language", v)}>
      <SelectTrigger
        size="sm"
        className="mx-auto w-auto gap-2"
        aria-label={t("settings.items.calendar-language")}
      >
        <Languages className="size-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="system">
          {t("settings.calendar.languageSystem")}
        </SelectItem>
        {languageCodes.map((code) => (
          <SelectItem key={code} value={code}>
            {languageNames[code]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
