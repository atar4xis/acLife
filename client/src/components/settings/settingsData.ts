export interface SettingItem {
  id: string;
  label: string;
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
          { id: "theme-mode", label: "Theme mode" },
          { id: "custom-theme", label: "Custom theme" },
          { id: "presets-list", label: "User themes" },
        ],
      },
      {
        id: "font",
        label: "Font",
        items: [
          { id: "font-family", label: "Font family" },
          { id: "font-size", label: "Font size" },
        ],
      },
      {
        id: "colors",
        label: "Colors",
        items: [{ id: "colors-overrides", label: "Color overrides" }],
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
          { id: "security-unlock-method", label: "Data decryption method" },
          { id: "security-auto-lock", label: "Auto-lock" },
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
        id: "timezones",
        label: "Time zones",
        items: [{ id: "calendar-timezones-list", label: "Time zones" }],
      },
      {
        id: "grid",
        label: "Grid",
        items: [
          { id: "calendar-default-view", label: "Default view" },
          { id: "calendar-week-start", label: "Week start" },
          { id: "calendar-snap-minutes", label: "Snap to minutes" },
        ],
      },
      {
        id: "events",
        label: "Event defaults",
        items: [
          { id: "calendar-default-event-name", label: "Default event name" },
          { id: "calendar-default-task-name", label: "Default task name" },
          {
            id: "calendar-default-event-duration",
            label: "Default event duration",
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
          },
          {
            id: "calendar-event-editor-add-colors-automatically",
            label: "Add new colors automatically",
          },
        ],
      },
      {
        id: "agenda",
        label: "Agenda view",
        items: [
          { id: "calendar-agenda-enabled", label: "Enabled" },
          { id: "calendar-agenda-range", label: "Range" },
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
        id: "push-service",
        label: "Push service",
        items: [{ id: "sync-push-status", label: "Enabled" }],
      },
      {
        id: "resync",
        label: "Resync",
        items: [{ id: "sync-resync-interval", label: "Resync interval" }],
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

export function sectionLabel(sectionId: string): string {
  const label = sectionLabels.get(sectionId);
  if (!label) throw new Error(`Unknown section id: ${sectionId}`);
  return label;
}
