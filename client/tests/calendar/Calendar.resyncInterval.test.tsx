import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({
    user: { type: "online", id: "user-1" },
    masterKey: {} as CryptoKey,
    bucketKey: {} as CryptoKey,
    setUser: () => {},
    setMasterKey: () => {},
    setBucketKey: () => {},
    logout: () => {},
    checkLogin: async () => {},
  }),
}));

import { act } from "@testing-library/react";
import { CLIENT_ID } from "../../src/lib/clientId";
import { emitStream } from "../../src/lib/stream";
import { renderCalendar, setupCalendarTests } from "./helpers";
import { seedSettings } from "../settingsStorage.ts";

setupCalendarTests();


describe("Calendar resync interval", () => {
  it("schedules the resync interval using the configured resyncIntervalMinutes", () => {
    seedSettings({ resyncIntervalMinutes: 30 });
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    renderCalendar({ mode: "week" });

    const resyncCall = setIntervalSpy.mock.calls.find(
      (call) => call[1] === 30 * 60000,
    );
    expect(resyncCall).toBeDefined();

    setIntervalSpy.mockRestore();
  });

  it("falls back to a 15 minute resync interval when resyncIntervalMinutes is unset", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    renderCalendar({ mode: "week" });

    const resyncCall = setIntervalSpy.mock.calls.find(
      (call) => call[1] === 15 * 60000,
    );
    expect(resyncCall).toBeDefined();

    setIntervalSpy.mockRestore();
  });

  it.each([
    ["another client", "other1"],
    ["this client, e.g. a save too large to replicate", CLIENT_ID],
    ["no client, e.g. after a gap", undefined],
  ])("resyncs on a sync event from %s", (_, originClientId) => {
    const syncEvents = vi.fn().mockResolvedValue([]);
    renderCalendar({ mode: "week", syncEvents });
    syncEvents.mockClear();

    act(() => emitStream({ type: "sync", originClientId }));

    expect(syncEvents).toHaveBeenCalledTimes(1);
  });

  it("stops resyncing on sync events once unmounted", () => {
    const syncEvents = vi.fn().mockResolvedValue([]);
    const { unmount } = renderCalendar({ mode: "week", syncEvents });
    syncEvents.mockClear();
    unmount();

    emitStream({ type: "sync" });

    expect(syncEvents).not.toHaveBeenCalled();
  });
});
