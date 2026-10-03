import { act, renderHook } from "@testing-library/react";
import { Settings } from "luxon";
import { describe, expect, it, vi } from "vitest";
import {
  ThemeProvider,
  useTheme,
} from "../../src/components/ThemeProvider.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import { useCalendarSettings } from "../../src/context/CalendarSettingsContext.tsx";
import { defaultStoreSettings } from "../../src/lib/settingsDefaults.ts";
import {
  SETTINGS_STORAGE_KEY,
  createSettingsStore,
} from "../../src/lib/settingsStore.ts";
import {
  isSyncable,
  isSyncActive,
  isSynced,
  syncByDefault,
  syncGroups,
} from "../../src/lib/settingsSync.ts";
import { MAX_PRESETS } from "../../src/lib/constants.ts";
import { MAX_PRESET_BYTES } from "../../src/lib/themePresets.ts";
import { readSettingsMeta, seedSettings } from "../settingsStorage.ts";

describe("settings store", () => {
  it("starts from the defaults when nothing is stored", () => {
    const store = createSettingsStore();

    expect(store.getSnapshot()).toEqual(defaultStoreSettings);
    expect(store.getMeta()).toEqual({
      updatedAt: {},
      syncOverrides: {},
      syncEnabled: true,
    });
  });

  it("does not write anything until a setting changes", () => {
    createSettingsStore();

    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("persists changes and restores them in a new store", () => {
    createSettingsStore().setSetting("snapMinutes", 15);

    expect(createSettingsStore().getSnapshot().snapMinutes).toBe(15);
  });

  it("stamps updatedAt only for the keys that changed", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const store = createSettingsStore();

    store.setSettings({ snapMinutes: 15, defaultView: "week" });

    // defaultView already was "week", so it is not a change
    expect(store.getMeta().updatedAt).toEqual({ snapMinutes: 1000 });
  });

  it("keeps earlier timestamps when another key changes later", () => {
    const now = vi.spyOn(Date, "now");
    const store = createSettingsStore();

    now.mockReturnValue(1000);
    store.setSetting("snapMinutes", 15);
    now.mockReturnValue(2000);
    store.setSetting("defaultView", "day");

    expect(store.getMeta().updatedAt).toEqual({
      snapMinutes: 1000,
      defaultView: 2000,
    });
  });

  it("ignores writes that do not change anything", () => {
    const store = createSettingsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setSetting("snapMinutes", defaultStoreSettings.snapMinutes);
    store.setSettings({});

    expect(listener).not.toHaveBeenCalled();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("notifies listeners once for a multi-key update", () => {
    const store = createSettingsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setSettings({ snapMinutes: 15, defaultView: "day" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribing", () => {
    const store = createSettingsStore();
    const listener = vi.fn();
    store.subscribe(listener)();

    store.setSetting("snapMinutes", 15);

    expect(listener).not.toHaveBeenCalled();
  });

  it("stores sync choices that differ from the default", () => {
    const store = createSettingsStore();

    store.setSyncOverrides({ snapMinutes: true, defaultView: false });

    expect(readSettingsMeta().syncOverrides).toEqual({
      snapMinutes: true,
      defaultView: false,
    });
  });

  it("drops a sync choice once it matches the default again", () => {
    const store = createSettingsStore();
    store.setSyncOverrides({ snapMinutes: true, defaultView: false });

    store.setSyncOverrides({ snapMinutes: false });

    expect(readSettingsMeta().syncOverrides).toEqual({ defaultView: false });
  });

  it("does not write when a sync choice is unchanged", () => {
    const store = createSettingsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setSyncOverrides({ snapMinutes: false, defaultView: true });

    expect(listener).not.toHaveBeenCalled();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("changes several sync choices with a single notification", () => {
    const store = createSettingsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setSyncOverrides({ snapMinutes: true, defaultView: false });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the sync choices when the master switch is turned off and on", () => {
    const store = createSettingsStore();
    store.setSyncOverrides({ snapMinutes: true });

    store.setSyncEnabled(false);
    expect(createSettingsStore().getMeta().syncEnabled).toBe(false);
    expect(createSettingsStore().getMeta().syncOverrides).toEqual({
      snapMinutes: true,
    });

    store.setSyncEnabled(true);
    expect(createSettingsStore().getMeta().syncEnabled).toBe(true);
    expect(createSettingsStore().getMeta().syncOverrides).toEqual({
      snapMinutes: true,
    });
  });

  it("does not write when the master switch is set to its current value", () => {
    const store = createSettingsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setSyncEnabled(true);

    expect(listener).not.toHaveBeenCalled();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("has sync turned on by default", () => {
    expect(createSettingsStore().getMeta().syncEnabled).toBe(true);
  });

  it("repairs invalid stored values", () => {
    seedSettings({
      dayHeaderPosition: "left",
      timeLabelPosition: "top",
      fontSize: "abc",
      presets: "nope",
      timezones: ["Not/AZone"],
    });

    const settings = createSettingsStore().getSnapshot();

    expect(settings.dayHeaderPosition).toBe("top");
    expect(settings.timeLabelPosition).toBe("auto");
    expect(settings.fontSize).toBe(16);
    expect(settings.presets).toEqual([]);
    expect(settings.timezones).toEqual(defaultStoreSettings.timezones);
  });

  it("keeps a stored language only if a locale file exists for it", () => {
    seedSettings({ language: "es" });
    expect(createSettingsStore().getSnapshot().language).toBe("es");

    seedSettings({ language: "xx" });
    expect(createSettingsStore().getSnapshot().language).toBe("system");
  });

  it.each([
    ["timezones is a string", { timezones: "UTC" }],
    ["timezones is a number", { timezones: 5 }],
    ["timezones is an object", { timezones: { 0: "UTC" } }],
    ["timezones holds non-strings", { timezones: [1, null, {}] }],
    ["colors is an array", { colors: ["#fff"] }],
    ["colors is a string", { colors: "red" }],
    ["eventColorPresets is an object", { eventColorPresets: { length: 3 } }],
    ["eventColorPresets is a string", { eventColorPresets: "#fff" }],
    ["presets is an object", { presets: {} }],
    ["defaultView is unknown", { defaultView: "month" }],
    ["weekStartsOn is out of range", { weekStartsOn: 9 }],
    ["numbers are not finite", { snapMinutes: null, fontSize: "big" }],
    ["strings are numbers", { defaultEventName: 5, fontFamily: [] }],
    ["booleans are strings", { agendaEnabled: "yes" }],
  ])("falls back to the defaults when %s", (_name, values) => {
    seedSettings(values);

    const settings = createSettingsStore().getSnapshot();

    expect(settings).toEqual(defaultStoreSettings);
  });

  it("drops junk entries but keeps the valid ones in stored lists", () => {
    seedSettings({
      timezones: ["Europe/Paris", 7, "Not/AZone", null],
      colors: { sidebar: "#123456", card: 5 },
      eventColorPresets: ["#111111", 3, null],
      presets: [
        { id: "a", name: "A", colors: {}, fontFamily: "", fontSize: 16 },
        { id: 1, name: "bad" },
        { id: 2, name: "numeric id", colors: {}, fontFamily: "", fontSize: 16 },
        { id: "b", name: "no font size", colors: {}, fontFamily: "" },
        { id: "c", name: 5, colors: {}, fontFamily: "", fontSize: 16 },
        {
          id: "d",
          name: "colors array",
          colors: [],
          fontFamily: "",
          fontSize: 16,
        },
        {
          id: "e",
          name: "font family",
          colors: {},
          fontFamily: 3,
          fontSize: 16,
        },
        "junk",
        null,
      ],
    });

    const settings = createSettingsStore().getSnapshot();

    expect(settings.timezones).toEqual(["Europe/Paris"]);
    expect(settings.defaultTimezone).toBe("Europe/Paris");
    expect(settings.colors).toEqual({ sidebar: "#123456" });
    expect(settings.eventColorPresets).toEqual(["#111111"]);
    expect(settings.presets.map((p) => p.id)).toEqual(["a"]);
  });

  it("keeps at most MAX_PRESETS stored presets", () => {
    seedSettings({
      presets: Array.from({ length: MAX_PRESETS + 5 }, (_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
        colors: {},
        fontFamily: "",
        fontSize: 16,
      })),
    });

    expect(createSettingsStore().getSnapshot().presets).toHaveLength(
      MAX_PRESETS,
    );
  });

  it("keeps a stored active preset id and drops one of the wrong type", () => {
    seedSettings({ activePresetId: "preset-1" });
    expect(createSettingsStore().getSnapshot().activePresetId).toBe("preset-1");

    seedSettings({ activePresetId: 7 });
    expect(createSettingsStore().getSnapshot().activePresetId).toBeNull();
  });

  it("ignores stored keys it does not know about", () => {
    seedSettings({ snapMinutes: 15, somethingElse: "x" });

    const settings = createSettingsStore().getSnapshot();

    expect(settings.snapMinutes).toBe(15);
    expect(settings).not.toHaveProperty("somethingElse");
  });

  it.each([
    ["values is an array", { values: [1, 2] }],
    ["values is a string", { values: "oops" }],
    ["the whole blob is an array", [1, 2, 3]],
    ["the whole blob is a number", 42],
    [
      "updatedAt and syncOverrides are wrong",
      { updatedAt: [], syncOverrides: "x" },
    ],
    ["syncEnabled is not a boolean", { syncEnabled: "no" }],
  ])("survives a stored blob where %s", (_name, blob) => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(blob));

    const store = createSettingsStore();

    expect(store.getSnapshot()).toEqual(defaultStoreSettings);
    expect(store.getMeta()).toEqual({
      updatedAt: {},
      syncOverrides: {},
      syncEnabled: true,
    });
  });

  it("keeps a valid week start, including the old string form", () => {
    seedSettings({ weekStartsOn: 3 });
    expect(createSettingsStore().getSnapshot().weekStartsOn).toBe(3);

    seedSettings({ weekStartsOn: "sun" });
    expect(createSettingsStore().getSnapshot().weekStartsOn).toBe(7);

    seedSettings({ weekStartsOn: "inherit" });
    expect(createSettingsStore().getSnapshot().weekStartsOn).toBe("inherit");
  });

  it("recovers from a corrupt stored blob", () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, "{not json");

    expect(createSettingsStore().getSnapshot()).toEqual(defaultStoreSettings);
  });

  it("applies the default time zone to luxon on load and on change", () => {
    seedSettings({
      timezones: ["America/Chicago"],
      defaultTimezone: "America/Chicago",
    });
    const store = createSettingsStore();
    expect(Settings.defaultZone.name).toBe("America/Chicago");

    store.setSettings({
      timezones: ["Asia/Tokyo"],
      defaultTimezone: "Asia/Tokyo",
    });
    expect(Settings.defaultZone.name).toBe("Asia/Tokyo");
  });
});

describe("sync rules", () => {
  it("only marks the agreed settings as syncable", () => {
    expect(Object.keys(syncByDefault).sort()).toEqual(
      [
        "addColorsAutomatically",
        "agendaEnabled",
        "agendaRangeDays",
        "colors",
        "dateFormat",
        "dateTimeFormat",
        "dayHeaderPosition",
        "defaultEventDuration",
        "defaultEventName",
        "defaultTaskName",
        "defaultTimezone",
        "defaultView",
        "eventColorPresets",
        "eventEditorBlur",
        "eventEditorOpacity",
        "eventEditorRadius",
        "fontFamily",
        "fontSize",
        "language",
        "lineOpacity",
        "presets",
        "miniCalendarEnabled",
        "miniCalendarEventBars",
        "miniCalendarWeekNumbers",
        "miniCalendarBoldDayNumbers",
        "miniCalendarAdaptiveNumbers",
        "miniCalendarDropdowns",
        "detachRecurringOnEdit",
        "snapMinutes",
        "theme",
        "timeFormat",
        "timeLabelPosition",
        "timezones",
        "weekStartsOn",
      ].sort(),
    );
  });

  it.each([
    "resyncIntervalMinutes",
    "lastSeenDeviceTimezone",
    "activePresetId",
    "lastBase",
    "unlockMethod",
    "autoLock",
  ])("never syncs the device-local setting %s", (key) => {
    expect(isSyncable(key)).toBe(false);
    expect(isSynced(key, { [key]: true } as never)).toBe(false);
  });

  it.each(["defaultView", "presets", "eventColorPresets", "weekStartsOn"])(
    "syncs %s by default",
    (key) => {
      expect(isSynced(key, {})).toBe(true);
    },
  );

  it.each([
    "snapMinutes",
    "theme",
    "colors",
    "fontFamily",
    "fontSize",
    "timezones",
    "defaultTimezone",
  ])("does not sync %s by default", (key) => {
    expect(isSyncable(key)).toBe(true);
    expect(isSynced(key, {})).toBe(false);
  });

  it("lets a user override change the default in both directions", () => {
    expect(isSynced("snapMinutes", { snapMinutes: true })).toBe(true);
    expect(isSynced("defaultView", { defaultView: false })).toBe(false);
  });
});

describe("effective sync", () => {
  it("syncs a setting only when the master switch and the setting are both on", () => {
    expect(isSyncActive("defaultView", { enabled: true, overrides: {} })).toBe(
      true,
    );
    expect(isSyncActive("defaultView", { enabled: false, overrides: {} })).toBe(
      false,
    );
    expect(
      isSyncActive("defaultView", {
        enabled: true,
        overrides: { defaultView: false },
      }),
    ).toBe(false);
    expect(
      isSyncActive("snapMinutes", {
        enabled: true,
        overrides: { snapMinutes: true },
      }),
    ).toBe(true);
  });

  it("never syncs a device-local setting, even with the master switch on", () => {
    expect(
      isSyncActive("resyncIntervalMinutes", { enabled: true, overrides: {} }),
    ).toBe(false);
  });

  it("lists every syncable setting in exactly one sync group", () => {
    const grouped = syncGroups.flatMap((group) => group.keys);

    expect([...grouped].sort()).toEqual(Object.keys(syncByDefault).sort());
  });
});

describe("shared store between hooks", () => {
  it("lets the calendar and theme hooks read and write one store", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SettingsStoreProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </SettingsStoreProvider>
    );
    const { result } = renderHook(
      () => ({ calendar: useCalendarSettings(), theme: useTheme() }),
      { wrapper },
    );

    act(() => {
      result.current.calendar.setSetting("snapMinutes", 15);
      result.current.theme.setFontSize(18);
    });

    const stored = readSettingsMeta();
    expect(stored.values.snapMinutes).toBe(15);
    expect(stored.values.fontSize).toBe(18);
    expect(result.current.calendar.snapMinutes).toBe(15);
    expect(result.current.theme.fontSize).toBe(18);
  });

  it("does not re-render a selector whose slice did not change", () => {
    const renders = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SettingsStoreProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </SettingsStoreProvider>
    );
    const { result } = renderHook(
      () => {
        renders();
        return useCalendarSettings((s) => ({
          view: s.defaultView,
          setSetting: s.setSetting,
        }));
      },
      { wrapper },
    );
    const before = renders.mock.calls.length;

    act(() => {
      result.current.setSetting("snapMinutes", 15);
    });

    // the selected slice (view and setter) is unchanged
    expect(renders.mock.calls.length).toBe(before);
  });

  it("applies remote settings with their timestamps", () => {
    const store = createSettingsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.applyRemote({ snapMinutes: 15 }, { snapMinutes: 42 });

    expect(store.getSnapshot().snapMinutes).toBe(15);
    expect(store.getMeta().updatedAt).toEqual({ snapMinutes: 42 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(createSettingsStore().getSnapshot().snapMinutes).toBe(15);
  });

  it("ignores remote values of the wrong type and does not stamp them", () => {
    const store = createSettingsStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.applyRemote({ snapMinutes: "soon" } as never, { snapMinutes: 42 });

    expect(store.getSnapshot()).toEqual(defaultStoreSettings);
    expect(store.getMeta().updatedAt).toEqual({});
    expect(listener).not.toHaveBeenCalled();
  });

  it("drops stored presets over the size limit", () => {
    const preset = (id: string, name: string) => ({
      id,
      name,
      colors: {},
      fontFamily: "",
      fontSize: 16,
    });
    seedSettings({
      presets: [
        preset("a", "Small"),
        preset("b", "x".repeat(MAX_PRESET_BYTES)),
      ],
    });

    expect(
      createSettingsStore()
        .getSnapshot()
        .presets.map((p) => p.id),
    ).toEqual(["a"]);
  });
});
