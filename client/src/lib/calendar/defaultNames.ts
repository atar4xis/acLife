import { t } from "@/i18n";
import { defaultCalendarSettings } from "@/lib/settingsDefaults";

const KEYS = {
  defaultEventName: "calendar.newEvent",
  defaultTaskName: "calendar.newTask",
} as const;

// the stored default is the English text, so only a customized name stays as typed
export const resolveDefaultName = (
  setting: keyof typeof KEYS,
  value: string,
) => (value === defaultCalendarSettings[setting] ? t(KEYS[setting]) : value);
