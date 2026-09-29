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

import { renderCalendar, setupCalendarTests } from "./helpers";
import { seedSettings } from "../settingsStorage.ts";

setupCalendarTests();


describe("Calendar resync interval", () => {
  it("schedules the resync interval using the configured resyncIntervalMinutes", () => {
    seedSettings({ resyncIntervalMinutes: 20 });
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    renderCalendar({ mode: "week" });

    const resyncCall = setIntervalSpy.mock.calls.find(
      (call) => call[1] === 20 * 60000,
    );
    expect(resyncCall).toBeDefined();

    setIntervalSpy.mockRestore();
  });

  it("falls back to a 5 minute resync interval when resyncIntervalMinutes is unset", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    renderCalendar({ mode: "week" });

    const resyncCall = setIntervalSpy.mock.calls.find(
      (call) => call[1] === 5 * 60000,
    );
    expect(resyncCall).toBeDefined();

    setIntervalSpy.mockRestore();
  });
});
