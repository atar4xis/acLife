import type { StoreKey, StoreSettings } from "@/lib/settingsDefaults";

// settings that can be synced to the server, mapped to whether they sync by default
export const syncByDefault = {
  defaultView: true,
  weekStartsOn: true,
  snapMinutes: false,
  lineOpacity: true,
  dayHeaderPosition: true,
  timeLabelPosition: true,
  defaultEventName: true,
  defaultTaskName: true,
  defaultEventDuration: true,
  agendaEnabled: true,
  agendaRangeDays: true,
  miniCalendarEnabled: true,
  miniCalendarEventBars: true,
  miniCalendarWeekNumbers: true,
  miniCalendarBoldDayNumbers: true,
  miniCalendarDropdowns: true,
  eventColorPresets: true,
  addColorsAutomatically: true,
  eventEditorOpacity: true,
  eventEditorBlur: true,
  eventEditorRadius: true,
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

type SyncEntry = { value: unknown; updatedAt?: unknown };

// includes keys this version does not know, so an upload never erases them
export type SyncPayload = Partial<Record<string, SyncEntry>>;

const MAX_CLOCK_SKEW_MS = 3600000;

// malformed and far-future stamps count as oldest so they never win a merge
const stampOf = (entry?: SyncEntry): number => {
  const stamp = entry?.updatedAt;
  return typeof stamp === "number" &&
    Number.isFinite(stamp) &&
    stamp <= Date.now() + MAX_CLOCK_SKEW_MS
    ? stamp
    : -1;
};

export function parseSyncPayload(value: unknown): SyncPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const payload: SyncPayload = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "object" && entry !== null) {
      payload[key] = entry as SyncEntry;
    }
  }
  return payload;
}

export function collectSynced(
  values: StoreSettings,
  updatedAt: Partial<Record<StoreKey, number>>,
  state: SyncState,
): SyncPayload {
  const payload: SyncPayload = {};
  for (const key of Object.keys(syncByDefault) as SyncableKey[]) {
    const stamp = updatedAt[key];
    if (stamp !== undefined && isSyncActive(key, state)) {
      payload[key] = { value: values[key], updatedAt: stamp };
    }
  }
  return payload;
}

export function newerRemote(
  remote: SyncPayload,
  updatedAt: Partial<Record<StoreKey, number>>,
  state: SyncState,
): {
  patch: Partial<StoreSettings>;
  stamps: Partial<Record<StoreKey, number>>;
} {
  const patch: Record<string, unknown> = {};
  const stamps: Partial<Record<StoreKey, number>> = {};
  for (const key of Object.keys(remote)) {
    const entry = remote[key]!;
    if (!isSyncable(key) || !isSyncActive(key, state)) continue;

    const stamp = stampOf(entry);
    if (stamp > (updatedAt[key] ?? 0)) {
      patch[key] = entry.value;
      stamps[key] = stamp;
    }
  }
  return { patch: patch as Partial<StoreSettings>, stamps };
}

const isNewer = (entry: SyncEntry, other?: SyncEntry) =>
  stampOf(entry) > stampOf(other);

export function hasNewerEntries(local: SyncPayload, remote: SyncPayload) {
  return Object.keys(local).some((key) => isNewer(local[key]!, remote[key]));
}

// per setting, keeps the entry with the newest timestamp
export function mergePayloads(a: SyncPayload, b: SyncPayload): SyncPayload {
  const merged: SyncPayload = { ...a };
  for (const key of Object.keys(b)) {
    if (isNewer(b[key]!, merged[key])) merged[key] = b[key];
  }
  return merged;
}

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
        "lineOpacity",
        "dayHeaderPosition",
        "timeLabelPosition",
        "agendaEnabled",
        "agendaRangeDays",
        "miniCalendarEnabled",
        "miniCalendarEventBars",
        "miniCalendarWeekNumbers",
        "miniCalendarBoldDayNumbers",
        "miniCalendarDropdowns",
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
        "eventEditorOpacity",
        "eventEditorBlur",
        "eventEditorRadius",
      ],
    },
    {
      id: "timezones",
      label: "Time zones",
      keys: ["timezones", "defaultTimezone"],
    },
  ];
