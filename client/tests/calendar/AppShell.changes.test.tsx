import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ID } from "../../src/lib/clientId";
import {
  emitStream,
  onStream,
  type StreamChange,
} from "../../src/lib/stream";

const masterKey = {} as CryptoKey;

const userMock = vi.hoisted(() => ({
  value: {} as { user: object | null; masterKey: object | null; bucketKey: object | null },
}));
const dispatch = vi.hoisted(() => vi.fn());
const applyChanges = vi.hoisted(() => vi.fn());
const pendingChanges = vi.hoisted(() => new Map<string, object[]>());

vi.mock("sonner", () => ({
  toast: { loading: vi.fn(), dismiss: vi.fn(), error: vi.fn() },
}));
vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => userMock.value,
}));
vi.mock("../../src/context/CalendarContext.tsx", () => ({
  useCalendarActions: () => ({
    dispatch,
    pendingChanges,
    setCurrentDate: vi.fn(),
    getCurrentDate: vi.fn(),
  }),
}));
vi.mock("../../src/context/CalendarSettingsContext.tsx", () => ({
  useCalendarSettings: (select: (s: object) => object) =>
    select({ defaultView: "week", defaultTimezone: "UTC" }),
}));
vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({}),
}));
vi.mock("../../src/hooks/useSettingsSync.ts", () => ({
  useSettingsSync: () => {},
}));
vi.mock("../../src/hooks/calendar/useCalendarEvents.ts", () => ({
  useCalendarEvents: () => ({
    saving: false,
    loadEvents: vi.fn(() => new Promise(() => {})),
    saveEvents: vi.fn(),
    syncEvents: vi.fn(),
    syncBuckets: vi.fn(),
    applyChanges,
  }),
}));
vi.mock("../../src/components/calendar/Calendar.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/Sidebar.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/PushService.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/StreamService.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/NotificationService.tsx", () => ({
  default: () => null,
}));
vi.mock("../../src/components/AutoLockService.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/settings/SettingsDialog.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/calendar/TimezoneChangeDialog.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/login/UnlockDialog.tsx", () => ({ default: () => null }));
vi.mock("../../src/components/subscription/SubscriptionDialog.tsx", () => ({ default: () => null }));

const { default: AppShell } = await import("../../src/components/AppShell");

const change: StreamChange = { type: "deleted", id: "a" };
const upsert: StreamChange = {
  type: "updated",
  id: "kept",
  data: "",
  updatedAt: 1,
};

describe("AppShell stream changes", () => {
  beforeEach(() => {
    dispatch.mockReset();
    pendingChanges.clear();
    applyChanges.mockReset().mockResolvedValue([{ id: "kept" }, { id: "unrelated" }]);
    userMock.value = {
      user: { type: "online" },
      masterKey,
      bucketKey: {},
    };
  });

  it("replicates changes from other clients into the calendar", async () => {
    render(<AppShell />);

    emitStream({
      type: "calendar",
      originClientId: "other1",
      changes: [change, upsert],
    });

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "merge",
        events: [{ id: "kept" }],
        deletedIds: ["a"],
      }),
    );
    expect(applyChanges).toHaveBeenCalledWith(
      [change, upsert],
      masterKey,
      userMock.value.bucketKey,
    );
  });

  it("does not bring back an event this client is deleting", async () => {
    pendingChanges.set("kept", [{ type: "updated" }, { type: "deleted" }]);
    render(<AppShell />);

    emitStream({
      type: "calendar",
      originClientId: "other1",
      changes: [upsert],
    });

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "merge",
        events: [],
        deletedIds: [],
      }),
    );
  });

  it("still applies a change to an event this client edited", async () => {
    pendingChanges.set("kept", [{ type: "deleted" }, { type: "added" }]);
    render(<AppShell />);

    emitStream({
      type: "calendar",
      originClientId: "other1",
      changes: [upsert],
    });

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "merge",
        events: [{ id: "kept" }],
        deletedIds: [],
      }),
    );
  });

  it("caches changes made by this client without redrawing the calendar", async () => {
    render(<AppShell />);

    emitStream({
      type: "calendar",
      originClientId: CLIENT_ID,
      changes: [change],
    });

    await waitFor(() =>
      expect(applyChanges).toHaveBeenCalledWith(
        [change],
        masterKey,
        userMock.value.bucketKey,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("asks for a full sync when the changes cannot be applied", async () => {
    applyChanges.mockRejectedValue(new Error("decrypt failed"));
    const onSync = vi.fn();
    const stop = onStream("sync", onSync);
    render(<AppShell />);

    emitStream({
      type: "calendar",
      originClientId: "other1",
      changes: [change],
    });

    await waitFor(() => expect(onSync).toHaveBeenCalledTimes(1));
    expect(dispatch).not.toHaveBeenCalled();
    stop();
  });

  it.each([
    ["locked", { user: { type: "online" }, masterKey: null, bucketKey: null }],
    ["offline", { user: { type: "offline" }, masterKey, bucketKey: null }],
  ])("does not apply changes while %s", (_, value) => {
    userMock.value = value;
    render(<AppShell />);

    emitStream({
      type: "calendar",
      originClientId: "other1",
      changes: [change],
    });

    expect(applyChanges).not.toHaveBeenCalled();
  });

  it("stops listening when unmounted", () => {
    const { unmount } = render(<AppShell />);
    unmount();

    emitStream({
      type: "calendar",
      originClientId: "other1",
      changes: [change],
    });

    expect(applyChanges).not.toHaveBeenCalled();
  });

  describe("work still running when the listener goes away", () => {
    const held = () => {
      let finish!: (outcome: () => unknown) => void;
      applyChanges.mockReset().mockReturnValue(
        new Promise((resolve, reject) => {
          finish = (outcome) => {
            try {
              resolve(outcome());
            } catch (err) {
              reject(err);
            }
          };
        }),
      );
      return (outcome: () => unknown) => finish(outcome);
    };
    const deliver = () =>
      emitStream({
        type: "calendar",
        originClientId: "other1",
        changes: [change],
      });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

    it("does not redraw after the data locks", async () => {
      const finish = held();
      const { rerender } = render(<AppShell />);
      deliver();

      userMock.value = { ...userMock.value, masterKey: null, bucketKey: null };
      rerender(<AppShell />);
      finish(() => [{ id: "stale" }]);
      await settle();

      expect(dispatch).not.toHaveBeenCalled();
    });

    it("does not redraw after unmounting", async () => {
      const finish = held();
      const { unmount } = render(<AppShell />);
      deliver();

      unmount();
      finish(() => [{ id: "stale" }]);
      await settle();

      expect(dispatch).not.toHaveBeenCalled();
    });

    it("does not ask for a sync after the data locks", async () => {
      const finish = held();
      const onSync = vi.fn();
      const stop = onStream("sync", onSync);
      const { rerender } = render(<AppShell />);
      deliver();

      userMock.value = { ...userMock.value, masterKey: null, bucketKey: null };
      rerender(<AppShell />);
      finish(() => {
        throw new Error("decrypt failed");
      });
      await settle();

      expect(onSync).not.toHaveBeenCalled();
      stop();
    });
  });
});
