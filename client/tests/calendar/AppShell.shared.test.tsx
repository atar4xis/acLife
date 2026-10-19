import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ID } from "../../src/lib/clientId";
import { emitStream, onStream } from "../../src/lib/stream";
import { toast } from "sonner";

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
const loadEvents = vi.hoisted(() => vi.fn());
const applySharedChanges = vi.hoisted(() => vi.fn());
const shares = vi.hoisted(() => ({
  value: { joined: [] as object[], owned: [] as object[], loaded: true },
}));
vi.mock("../../src/context/ShareContext.tsx", () => ({
  useShares: () => ({ contacts: [], invites: [], ...shares.value }),
}));
vi.mock("../../src/hooks/calendar/useCalendarEvents.ts", () => ({
  useCalendarEvents: () => ({
    saving: false,
    loadEvents,
    saveEvents: vi.fn(),
    syncEvents: vi.fn(),
    syncBuckets: vi.fn(),
    applyChanges,
    applySharedChanges,
  }),
}));
vi.mock("../../src/components/calendar/Calendar.tsx", () => ({
  default: ({ events }: { events: { id: string }[] }) => (
    <div data-testid="events">{events.map((e) => e.id).join()}</div>
  ),
}));
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

const calendar = (id: string, permission = "read") => ({
  id,
  kind: "calendar",
  permission,
});

describe("AppShell shared calendars", () => {
  beforeEach(() => {
    dispatch.mockReset();
    pendingChanges.clear();
    loadEvents.mockReset().mockResolvedValue([]);
    applySharedChanges.mockReset().mockResolvedValue({
      events: [{ id: "shared-1" }, { id: "gone-pending" }],
      deletedIds: ["x"],
    });
    shares.value = { loaded: true, joined: [], owned: [] };
    userMock.value = { user: { type: "online" }, masterKey, bucketKey: {} };
  });

  it("merges what another member changed", async () => {
    pendingChanges.set("gone-pending", [{ type: "deleted" }]);
    render(<AppShell />);

    emitStream({
      type: "space-updated",
      space: "s1",
      originClientId: "other1",
      changes: [{ type: "deleted", id: "x" }],
    });

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: "merge",
        events: [{ id: "shared-1" }],
        deletedIds: ["x"],
      }),
    );
    expect(applySharedChanges).toHaveBeenCalledWith(
      "s1",
      [{ type: "deleted", id: "x" }],
      false,
      masterKey,
      userMock.value.bucketKey,
    );
  });

  it("only caches what this client sent itself", async () => {
    render(<AppShell />);

    emitStream({
      type: "space-updated",
      space: "s1",
      originClientId: CLIENT_ID,
      changes: [{ type: "deleted", id: "x" }],
    });

    await waitFor(() =>
      expect(applySharedChanges).toHaveBeenCalledWith(
        "s1",
        expect.anything(),
        true,
        masterKey,
        userMock.value.bucketKey,
      ),
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("pulls everything when the change was too large to send", async () => {
    render(<AppShell />);
    const seen = vi.fn();
    const stop = onStream("sync", seen);

    emitStream({ type: "space-updated", space: "s1", originClientId: "other1" });

    await waitFor(() => expect(seen).toHaveBeenCalled());
    expect(applySharedChanges).not.toHaveBeenCalled();
    stop();
  });

  it("pulls everything when applying the change failed", async () => {
    applySharedChanges.mockRejectedValue(new Error("boom"));
    render(<AppShell />);
    const seen = vi.fn();
    const stop = onStream("sync", seen);

    emitStream({
      type: "space-updated",
      space: "s1",
      originClientId: "other1",
      changes: [{ type: "deleted", id: "x" }],
    });

    await waitFor(() => expect(seen).toHaveBeenCalled());
    stop();
  });

  it("ignores a shared message without a space", async () => {
    render(<AppShell />);

    emitStream({ type: "space-updated", originClientId: "other1", changes: [] });
    await act(async () => {});

    expect(applySharedChanges).not.toHaveBeenCalled();
  });

  it("loads the events again when a calendar is shared, changes permission or goes away", async () => {
    const view = render(<AppShell />);
    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(1));

    shares.value = { loaded: true, joined: [calendar("s1")], owned: [] };
    view.rerender(<AppShell />);
    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(2));

    shares.value = { loaded: true, joined: [calendar("s1", "write")], owned: [] };
    view.rerender(<AppShell />);
    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(3));

    shares.value = { loaded: true, joined: [], owned: [] };
    view.rerender(<AppShell />);
    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(4));
  });

  it("waits for the list of shares, so the calendars are loaded once", async () => {
    shares.value = { loaded: false, joined: [], owned: [] };
    const view = render(<AppShell />);
    await act(async () => {});
    expect(loadEvents).not.toHaveBeenCalled();

    shares.value = { loaded: true, joined: [calendar("s1")], owned: [] };
    view.rerender(<AppShell />);

    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(1));
  });

  it("does not load again for journals or for a re-render with the same calendars", async () => {
    shares.value = { loaded: true, joined: [calendar("s1")], owned: [] };
    const view = render(<AppShell />);
    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(1));

    shares.value = {
      loaded: true,
      joined: [calendar("s1"), { id: "j1", kind: "journal", permission: "write" }],
      owned: [{ id: "j2", kind: "journal" }],
    };
    view.rerender(<AppShell />);
    await act(async () => {});

    expect(loadEvents).toHaveBeenCalledTimes(1);
  });

  it("shows the newest load when an older one finishes last", async () => {
    let finishFirst: (events: object[]) => void = () => {};
    loadEvents
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishFirst = resolve)),
      )
      .mockResolvedValueOnce([{ id: "fresh" }]);
    const view = render(<AppShell />);
    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(1));

    shares.value = { loaded: true, joined: [calendar("s1")], owned: [] };
    view.rerender(<AppShell />);
    await waitFor(() =>
      expect(view.getByTestId("events").textContent).toBe("fresh"),
    );
    await act(async () => finishFirst([{ id: "stale" }]));

    expect(view.getByTestId("events").textContent).toBe("fresh");
  });

  it("leaves the loading toast of the newer load alone when an older one finishes", async () => {
    let finishFirst: (events: object[]) => void = () => {};
    loadEvents
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishFirst = resolve)),
      )
      .mockImplementationOnce(() => new Promise(() => {}));
    const view = render(<AppShell />);
    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(1));

    shares.value = { loaded: true, joined: [calendar("s1")], owned: [] };
    view.rerender(<AppShell />);
    await waitFor(() => expect(loadEvents).toHaveBeenCalledTimes(2));
    vi.mocked(toast.dismiss).mockClear();
    await act(async () => finishFirst([]));

    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  it("keeps edits that are still waiting to be saved when the events load again", async () => {
    pendingChanges.set("a", [{ type: "deleted" }]);
    pendingChanges.set("b", [{ type: "updated", event: { id: "b", title: "mine" } }]);
    pendingChanges.set("c", [{ type: "added", event: { id: "c" } }]);
    loadEvents.mockResolvedValue([{ id: "a" }, { id: "b", title: "saved" }, { id: "d" }]);
    const view = render(<AppShell />);

    await waitFor(() =>
      expect(view.getByTestId("events").textContent).toBe("b,d,c"),
    );
  });
});
