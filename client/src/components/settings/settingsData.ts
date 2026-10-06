import { t } from "@/i18n";
import type { SettingKey, StoreKey } from "@/lib/settingsDefaults";

export interface SettingItem {
  id: string;
  settingKey?: SettingKey | StoreKey;
}

export interface SettingsSection {
  id: string;
  items: SettingItem[];
}

export interface SettingsCategory {
  id: string;
  sections: SettingsSection[];
  hideOffline?: boolean;
  hideIfNoSubscription?: boolean;
}

export const settingsCategories: SettingsCategory[] = [
  {
    id: "application",
    sections: [
      {
        id: "updates",
        items: [
          { id: "updates-version" },
          { id: "updates-auto-check", settingKey: "autoCheckUpdates" },
          { id: "updates-auto-install", settingKey: "autoInstallUpdates" },
          { id: "updates-check" },
          { id: "updates-channel", settingKey: "updateChannel" },
          { id: "updates-changelog" },
        ],
      },
      {
        id: "about",
        items: [{ id: "about-version" }, { id: "about-website" }],
      },
    ],
  },
  {
    id: "appearance",
    sections: [
      {
        id: "theme",
        items: [
          { id: "theme-mode", settingKey: "theme" },
          { id: "custom-theme" },
          { id: "custom-css", settingKey: "customCss" },
          { id: "presets-list", settingKey: "presets" },
        ],
      },
      {
        id: "font",
        items: [
          { id: "font-family", settingKey: "fontFamily" },
          { id: "font-size", settingKey: "fontSize" },
        ],
      },
      {
        id: "colors",
        items: [
          {
            id: "colors-overrides",
            settingKey: "colors",
          },
        ],
      },
    ],
  },
  {
    id: "subscription",
    hideOffline: true,
    hideIfNoSubscription: true,
    sections: [
      {
        id: "plan",
        items: [{ id: "subscription-status" }, { id: "subscription-manage" }],
      },
      {
        id: "invoices",
        items: [{ id: "subscription-invoices" }],
      },
    ],
  },
  {
    id: "security",
    hideOffline: true,
    sections: [
      {
        id: "account",
        items: [{ id: "account-email" }, { id: "account-password" }],
      },
      {
        id: "encryption",
        items: [
          {
            id: "security-unlock-method",
            settingKey: "unlockMethod",
          },
          {
            id: "security-auto-lock",
            settingKey: "autoLock",
          },
        ],
      },
      {
        id: "sessions",
        items: [{ id: "security-sessions" }],
      },
    ],
  },
  {
    id: "region",
    sections: [
      {
        id: "language",
        items: [
          {
            id: "calendar-language",
            settingKey: "language",
          },
        ],
      },
      {
        id: "formats",
        items: [
          {
            id: "calendar-week-start",
            settingKey: "weekStartsOn",
          },
          {
            id: "calendar-time-format",
            settingKey: "timeFormat",
          },
          {
            id: "calendar-date-format",
            settingKey: "dateFormat",
          },
          {
            id: "calendar-date-time-format",
            settingKey: "dateTimeFormat",
          },
        ],
      },
      {
        id: "timezones",
        items: [
          {
            id: "calendar-default-timezone",
            settingKey: "defaultTimezone",
          },
          {
            id: "calendar-timezones-list",
            settingKey: "timezones",
          },
        ],
      },
    ],
  },
  {
    id: "calendar",
    sections: [
      {
        id: "behavior",
        items: [
          {
            id: "calendar-detach-recurring",
            settingKey: "detachRecurringOnEdit",
          },
          {
            id: "calendar-follow-current-time",
            settingKey: "followCurrentTime",
          },
          {
            id: "calendar-click-action",
            settingKey: "eventClickAction",
          },
          {
            id: "calendar-double-click-action",
            settingKey: "eventDoubleClickAction",
          },
        ],
      },
      {
        id: "grid",
        items: [
          {
            id: "calendar-default-view",
            settingKey: "defaultView",
          },
          {
            id: "calendar-snap-minutes",
            settingKey: "snapMinutes",
          },
          {
            id: "calendar-line-opacity",
            settingKey: "lineOpacity",
          },
          {
            id: "calendar-day-header-position",
            settingKey: "dayHeaderPosition",
          },
          {
            id: "calendar-time-label-position",
            settingKey: "timeLabelPosition",
          },
        ],
      },
      {
        id: "events",
        items: [
          {
            id: "calendar-default-event-name",
            settingKey: "defaultEventName",
          },
          {
            id: "calendar-default-task-name",
            settingKey: "defaultTaskName",
          },
          {
            id: "calendar-default-event-duration",
            settingKey: "defaultEventDuration",
          },
        ],
      },
      {
        id: "event-editor",
        items: [
          {
            id: "calendar-event-editor-color-presets",
            settingKey: "eventColorPresets",
          },
          {
            id: "calendar-event-editor-add-colors-automatically",
            settingKey: "addColorsAutomatically",
          },
          {
            id: "calendar-event-editor-opacity",
            settingKey: "eventEditorOpacity",
          },
          {
            id: "calendar-event-editor-blur",
            settingKey: "eventEditorBlur",
          },
          {
            id: "calendar-event-editor-radius",
            settingKey: "eventEditorRadius",
          },
        ],
      },
      {
        id: "mini-calendar",
        items: [
          {
            id: "mini-calendar-enabled",
            settingKey: "miniCalendarEnabled",
          },
          {
            id: "mini-calendar-event-bars",
            settingKey: "miniCalendarEventBars",
          },
          {
            id: "mini-calendar-adaptive-numbers",
            settingKey: "miniCalendarAdaptiveNumbers",
          },
          {
            id: "mini-calendar-week-numbers",
            settingKey: "miniCalendarWeekNumbers",
          },
          {
            id: "mini-calendar-bold-day-numbers",
            settingKey: "miniCalendarBoldDayNumbers",
          },
          {
            id: "mini-calendar-dropdowns",
            settingKey: "miniCalendarDropdowns",
          },
        ],
      },
      {
        id: "agenda",
        items: [
          {
            id: "calendar-agenda-enabled",
            settingKey: "agendaEnabled",
          },
          {
            id: "calendar-agenda-range",
            settingKey: "agendaRangeDays",
          },
          {
            id: "calendar-agenda-show-overdue",
            settingKey: "showOverdueTasks",
          },
          {
            id: "calendar-agenda-overdue-days",
            settingKey: "overdueDays",
          },
        ],
      },
    ],
  },
  {
    id: "sync",
    hideOffline: true,
    sections: [
      {
        id: "settings-sync",
        items: [{ id: "sync-settings-enabled" }],
      },
      {
        id: "push-service",
        items: [{ id: "sync-push-status" }],
      },
      {
        id: "resync",
        items: [
          {
            id: "sync-resync-interval",
            settingKey: "resyncIntervalMinutes",
          },
        ],
      },
    ],
  },
];

export interface SearchHit {
  categoryId: string;
  categoryLabel: string;
  sectionId: string;
  sectionLabel: string;
  itemId: string;
  itemLabel: string;
}

export const categoryLabel = (categoryId: string) =>
  t(`settings.categories.${categoryId}`);

export const sectionLabel = (sectionId: string) =>
  t(`settings.sections.${sectionId}`);

export const settingLabel = (itemId: string) => t(`settings.items.${itemId}`);

export const buildSearchIndex = (): SearchHit[] =>
  settingsCategories.flatMap((category) =>
    category.sections.flatMap((section) =>
      section.items.map((item) => ({
        categoryId: category.id,
        categoryLabel: categoryLabel(category.id),
        sectionId: section.id,
        sectionLabel: sectionLabel(section.id),
        itemId: item.id,
        itemLabel: settingLabel(item.id),
      })),
    ),
  );

const keyItemIds = new Map(
  settingsCategories.flatMap((category) =>
    category.sections.flatMap((section) =>
      section.items.flatMap((item) =>
        item.settingKey ? [[item.settingKey, item.id] as const] : [],
      ),
    ),
  ),
);

export function settingLabelId(settingKey: SettingKey | StoreKey): string {
  return `setting-label-${settingKey}`;
}

export function settingLabelByKey(settingKey: SettingKey | StoreKey): string {
  const itemId = keyItemIds.get(settingKey);
  if (!itemId) throw new Error(`Unknown setting key: ${settingKey}`);
  return settingLabel(itemId);
}
