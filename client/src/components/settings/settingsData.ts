import type { SettingKey, StoreKey } from "@/lib/settingsDefaults";

export interface SettingItem {
  id: string;
  label: string;
  settingKey?: SettingKey | StoreKey;
}

export interface SettingsSection {
  id: string;
  label: string;
  items: SettingItem[];
}

export interface SettingsCategory {
  id: string;
  label: string;
  sections: SettingsSection[];
  hideOffline?: boolean;
  hideIfNoSubscription?: boolean;
}

export const settingsCategories: SettingsCategory[] = [
  {
    id: "appearance",
    label: "Appearance",
    sections: [
      {
        id: "theme",
        label: "Theme",
        items: [
          { id: "theme-mode", label: "Theme mode", settingKey: "theme" },
          { id: "custom-theme", label: "Custom theme" },
          { id: "presets-list", label: "User themes", settingKey: "presets" },
        ],
      },
      {
        id: "font",
        label: "Font",
        items: [
          { id: "font-family", label: "Font family", settingKey: "fontFamily" },
          { id: "font-size", label: "Font size", settingKey: "fontSize" },
        ],
      },
      {
        id: "colors",
        label: "Colors",
        items: [
          {
            id: "colors-overrides",
            label: "Color overrides",
            settingKey: "colors",
          },
        ],
      },
    ],
  },
  {
    id: "subscription",
    label: "Subscription",
    hideOffline: true,
    hideIfNoSubscription: true,
    sections: [
      {
        id: "plan",
        label: "Your plan",
        items: [
          { id: "subscription-status", label: "Subscription status" },
          { id: "subscription-manage", label: "Manage subscription" },
        ],
      },
      {
        id: "invoices",
        label: "Invoices",
        items: [{ id: "subscription-invoices", label: "Invoices" }],
      },
    ],
  },
  {
    id: "security",
    label: "Account & Security",
    hideOffline: true,
    sections: [
      {
        id: "account",
        label: "Account",
        items: [
          { id: "account-email", label: "Email address" },
          { id: "account-password", label: "Password" },
        ],
      },
      {
        id: "encryption",
        label: "Encryption",
        items: [
          {
            id: "security-unlock-method",
            label: "Data decryption method",
            settingKey: "unlockMethod",
          },
          {
            id: "security-auto-lock",
            label: "Auto-lock",
            settingKey: "autoLock",
          },
        ],
      },
      {
        id: "sessions",
        label: "Active sessions",
        items: [{ id: "security-sessions", label: "Sessions" }],
      },
    ],
  },
  {
    id: "calendar",
    label: "Calendar",
    sections: [
      {
        id: "region",
        label: "Region",
        items: [
          {
            id: "calendar-week-start",
            label: "Week start",
            settingKey: "weekStartsOn",
          },
          {
            id: "calendar-default-timezone",
            label: "Default time zone",
            settingKey: "defaultTimezone",
          },
          {
            id: "calendar-timezones-list",
            label: "Time zones",
            settingKey: "timezones",
          },
        ],
      },
      {
        id: "grid",
        label: "Grid",
        items: [
          {
            id: "calendar-default-view",
            label: "Default view",
            settingKey: "defaultView",
          },
          {
            id: "calendar-snap-minutes",
            label: "Snap to minutes",
            settingKey: "snapMinutes",
          },
          {
            id: "calendar-line-opacity",
            label: "Line opacity",
            settingKey: "lineOpacity",
          },
          {
            id: "calendar-day-header-position",
            label: "Day header position",
            settingKey: "dayHeaderPosition",
          },
          {
            id: "calendar-time-label-position",
            label: "Time labels position",
            settingKey: "timeLabelPosition",
          },
        ],
      },
      {
        id: "events",
        label: "Event defaults",
        items: [
          {
            id: "calendar-default-event-name",
            label: "Default event name",
            settingKey: "defaultEventName",
          },
          {
            id: "calendar-default-task-name",
            label: "Default task name",
            settingKey: "defaultTaskName",
          },
          {
            id: "calendar-default-event-duration",
            label: "Default event duration",
            settingKey: "defaultEventDuration",
          },
        ],
      },
      {
        id: "event-editor",
        label: "Event editor",
        items: [
          {
            id: "calendar-event-editor-color-presets",
            label: "Color presets",
            settingKey: "eventColorPresets",
          },
          {
            id: "calendar-event-editor-add-colors-automatically",
            label: "Add new colors automatically",
            settingKey: "addColorsAutomatically",
          },
          {
            id: "calendar-event-editor-opacity",
            label: "Background opacity",
            settingKey: "eventEditorOpacity",
          },
          {
            id: "calendar-event-editor-blur",
            label: "Background blur",
            settingKey: "eventEditorBlur",
          },
          {
            id: "calendar-event-editor-radius",
            label: "Border radius",
            settingKey: "eventEditorRadius",
          },
        ],
      },
      {
        id: "agenda",
        label: "Agenda view",
        items: [
          {
            id: "calendar-agenda-enabled",
            label: "Enabled",
            settingKey: "agendaEnabled",
          },
          {
            id: "calendar-agenda-range",
            label: "Range",
            settingKey: "agendaRangeDays",
          },
        ],
      },
    ],
  },
  {
    id: "sync",
    label: "Sync",
    hideOffline: true,
    sections: [
      {
        id: "settings-sync",
        label: "Settings",
        items: [{ id: "sync-settings-enabled", label: "Sync settings" }],
      },
      {
        id: "push-service",
        label: "Push service",
        items: [{ id: "sync-push-status", label: "Enabled" }],
      },
      {
        id: "resync",
        label: "Resync",
        items: [
          {
            id: "sync-resync-interval",
            label: "Resync interval",
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

export const searchIndex: SearchHit[] = settingsCategories.flatMap((category) =>
  category.sections.flatMap((section) =>
    section.items.map((item) => ({
      categoryId: category.id,
      categoryLabel: category.label,
      sectionId: section.id,
      sectionLabel: section.label,
      itemId: item.id,
      itemLabel: item.label,
    })),
  ),
);

const itemLabels = new Map(
  searchIndex.map((hit) => [hit.itemId, hit.itemLabel]),
);
const sectionLabels = new Map(
  searchIndex.map((hit) => [hit.sectionId, hit.sectionLabel]),
);

export function settingLabel(itemId: string): string {
  const label = itemLabels.get(itemId);
  if (!label) throw new Error(`Unknown setting id: ${itemId}`);
  return label;
}

const keyLabels = new Map(
  settingsCategories.flatMap((category) =>
    category.sections.flatMap((section) =>
      section.items.flatMap((item) =>
        item.settingKey ? [[item.settingKey, item.label] as const] : [],
      ),
    ),
  ),
);

export function settingLabelId(settingKey: SettingKey | StoreKey): string {
  return `setting-label-${settingKey}`;
}

export function settingLabelByKey(settingKey: SettingKey | StoreKey): string {
  const label = keyLabels.get(settingKey);
  if (!label) throw new Error(`Unknown setting key: ${settingKey}`);
  return label;
}

export function sectionLabel(sectionId: string): string {
  const label = sectionLabels.get(sectionId);
  if (!label) throw new Error(`Unknown section id: ${sectionId}`);
  return label;
}
