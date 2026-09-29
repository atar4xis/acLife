import type { StoreKey } from "@/lib/settingsDefaults";

// settings that can be synced to the server, mapped to whether they sync by default
export const syncByDefault = {
  defaultView: true,
  weekStartsOn: true,
  snapMinutes: false,
  dayHeaderPosition: true,
  timeLabelPosition: true,
  defaultEventName: true,
  defaultTaskName: true,
  defaultEventDuration: true,
  agendaEnabled: true,
  agendaRangeDays: true,
  eventColorPresets: true,
  addColorsAutomatically: true,
  presets: true,
  theme: false,
  colors: false,
  fontFamily: false,
  fontSize: false,
  timezones: false,
  defaultTimezone: false,
} as const satisfies Partial<Record<StoreKey, boolean>>;

export type SyncableKey = keyof typeof syncByDefault;

// the user's per-setting choices, only stored when they differ from the default
export type SyncOverrides = Partial<Record<SyncableKey, boolean>>;

export const isSyncable = (key: string): key is SyncableKey =>
  key in syncByDefault;

// the user's choice for a single setting, ignoring the master switch
export const isSynced = (key: string, overrides: SyncOverrides): boolean =>
  isSyncable(key) && (overrides[key] ?? syncByDefault[key]);

export interface SyncState {
  enabled: boolean;
  overrides: SyncOverrides;
}

// whether a setting actually syncs, which is what the sync layer should check
export const isSyncActive = (key: string, state: SyncState): boolean =>
  state.enabled && isSynced(key, state.overrides);

export const syncGroups: { id: string; label: string; keys: SyncableKey[] }[] =
  [
    {
      id: "appearance",
      label: "Appearance",
      keys: ["theme", "colors", "fontFamily", "fontSize", "presets"],
    },
    {
      id: "calendar",
      label: "Calendar",
      keys: [
        "defaultView",
        "weekStartsOn",
        "snapMinutes",
        "dayHeaderPosition",
        "timeLabelPosition",
        "agendaEnabled",
        "agendaRangeDays",
      ],
    },
    {
      id: "events",
      label: "Events",
      keys: [
        "defaultEventName",
        "defaultTaskName",
        "defaultEventDuration",
        "eventColorPresets",
        "addColorsAutomatically",
      ],
    },
    {
      id: "timezones",
      label: "Time zones",
      keys: ["timezones", "defaultTimezone"],
    },
  ];
