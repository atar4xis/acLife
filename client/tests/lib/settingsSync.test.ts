import { describe, expect, it } from "vitest";
import { defaultStoreSettings } from "@/lib/settingsDefaults";
import {
  collectSynced,
  hasNewerEntries,
  mergePayloads,
  newerRemote,
  parseSyncPayload,
} from "@/lib/settingsSync";

const on = { enabled: true, overrides: {} };

describe("settings sync helpers", () => {
  it("collects only changed, synced settings", () => {
    const payload = collectSynced(
      defaultStoreSettings,
      { defaultView: 5, theme: 6, snapMinutes: 7 },
      on,
    );
    expect(Object.keys(payload)).toEqual(["defaultView"]);
  });

  it("collects nothing when the master switch is off", () => {
    const payload = collectSynced(
      defaultStoreSettings,
      { defaultView: 5 },
      { enabled: false, overrides: {} },
    );
    expect(payload).toEqual({});
  });

  it("applies only newer, active remote settings", () => {
    const { patch, stamps } = newerRemote(
      {
        defaultView: { value: "day", updatedAt: 10 },
        weekStartsOn: { value: 1, updatedAt: 3 },
        theme: { value: "dark", updatedAt: 10 },
      },
      { weekStartsOn: 5 },
      on,
    );
    expect(patch).toEqual({ defaultView: "day" });
    expect(stamps).toEqual({ defaultView: 10 });
  });

  it("merges per setting, newest wins", () => {
    const merged = mergePayloads(
      { defaultView: { value: "day", updatedAt: 1 } },
      {
        defaultView: { value: "week", updatedAt: 2 },
        lineOpacity: { value: 20, updatedAt: 1 },
      },
    );
    expect(merged.defaultView?.value).toBe("week");
    expect(merged.lineOpacity?.value).toBe(20);
  });

  it("keeps every object entry when parsing, known or not", () => {
    const payload = parseSyncPayload({
      defaultView: { value: "day", updatedAt: 4 },
      futureSetting: { value: 1, updatedAt: 1 },
      lineOpacity: { value: 20 },
      weekStartsOn: null,
    });
    expect(Object.keys(payload ?? {})).toEqual([
      "defaultView",
      "futureSetting",
      "lineOpacity",
    ]);
  });

  it("keeps unknown remote settings through a merge but never applies them", () => {
    const remote = { futureSetting: { value: 1, updatedAt: 9 } };
    const local = { defaultView: { value: "day", updatedAt: 2 } };

    expect(Object.keys(mergePayloads(remote, local)).sort()).toEqual([
      "defaultView",
      "futureSetting",
    ]);
    expect(newerRemote(remote, {}, on)).toEqual({ patch: {}, stamps: {} });
  });

  it("neither applies nor protects entries with a malformed or far-future stamp", () => {
    const remote = {
      defaultView: { value: "day", updatedAt: Date.now() + 24 * 3600000 },
      snapMinutes: { value: 5, updatedAt: "9" },
    };
    const local = {
      defaultView: { value: "week", updatedAt: 2 },
      snapMinutes: { value: 15, updatedAt: 3 },
    };

    expect(newerRemote(remote, {}, on)).toEqual({ patch: {}, stamps: {} });
    expect(mergePayloads(remote, local)).toEqual(local);
  });

  it("rejects payloads that are not objects", () => {
    expect(parseSyncPayload(null)).toBeNull();
    expect(parseSyncPayload([])).toBeNull();
    expect(parseSyncPayload("x")).toBeNull();
  });

  it("needs an upload only for entries missing or newer than the remote", () => {
    const remote = { defaultView: { value: "day", updatedAt: 5 } };

    expect(hasNewerEntries({}, remote)).toBe(false);
    expect(
      hasNewerEntries({ defaultView: { value: "day", updatedAt: 5 } }, remote),
    ).toBe(false);
    expect(
      hasNewerEntries({ defaultView: { value: "week", updatedAt: 6 } }, remote),
    ).toBe(true);
    expect(
      hasNewerEntries({ lineOpacity: { value: 20, updatedAt: 1 } }, remote),
    ).toBe(true);
  });
});
