import { act, render } from "@testing-library/react";
import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import { seedSettings } from "../settingsStorage.ts";
import NotificationService from "../../src/components/NotificationService.tsx";
import type {
  CalendarEvent,
  EventNotification,
} from "../../src/types/calendar/Event.ts";

const NOW = DateTime.fromISO("2026-03-02T08:00:00Z");

const mocks = vi.hoisted(() => ({
  events: [] as CalendarEvent[],
  user: { type: "online" } as { type: string } | null,
  subscription: null as string | null,
  post: vi.fn(),
  play: vi.fn(),
}));

vi.mock("../../src/context/CalendarContext.tsx", () => ({
  useEventList: () => mocks.events,
}));
vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ user: mocks.user }),
}));
vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ get: () => mocks.subscription }),
}));
vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({ post: mocks.post, serverMeta: null }),
}));
vi.mock("../../src/lib/calendar/notifications.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  playNotificationSound: mocks.play,
}));

const event = (
  id: string,
  startsInMinutes: number,
  notifications: EventNotification[],
): CalendarEvent => ({
  id,
  title: id,
  start: NOW.plus({ minutes: startsInMinutes }),
  end: NOW.plus({ minutes: startsInMinutes + 60 }),
  timestamp: 0,
  notifications,
});

const sound: EventNotification = { when: "start", amount: 0, method: "sound" };
const all: EventNotification = { when: "start", amount: 0, method: "all" };
const device: EventNotification = { when: "start", amount: 0, method: "device" };

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const sentEvents = (call = 0) => mocks.post.mock.calls[call][1].events;

describe("NotificationService", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ] });
    vi.setSystemTime(NOW.toJSDate());
    mocks.events = [];
    mocks.user = { type: "online" };
    mocks.subscription = null;
    mocks.post.mockReset().mockResolvedValue({ success: true, data: { retry: [] } });
    mocks.play.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  describe("sound", () => {
    it("plays when the notification is due, not before", async () => {
      mocks.events = [event("a", 10, [sound])];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);

      await advance(9 * 60 * 1000);
      expect(mocks.play).not.toHaveBeenCalled();

      await advance(60 * 1000);
      expect(mocks.play).toHaveBeenCalledTimes(1);
    });

    it("plays the chosen sound at the chosen volume", async () => {
      seedSettings({ notificationSound: 3, notificationVolume: 40 });
      mocks.events = [event("a", 10, [sound])];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);

      await advance(10 * 60 * 1000);

      expect(mocks.play).toHaveBeenCalledWith(3, 40);
    });

    it("plays once per notification", async () => {
      mocks.events = [
        event("a", 10, [sound, { when: "minutes", amount: 5, method: "sound" }]),
      ];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);

      await advance(5 * 60 * 1000);
      expect(mocks.play).toHaveBeenCalledTimes(1);
      await advance(5 * 60 * 1000);
      expect(mocks.play).toHaveBeenCalledTimes(2);
    });

    it("does not play for push notifications", async () => {
      mocks.events = [event("a", 10, [all, device])];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);

      await advance(11 * 60 * 1000);
      expect(mocks.play).not.toHaveBeenCalled();
    });

    it("skips a notification the device slept through", async () => {
      mocks.events = [event("a", 10, [sound])];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);

      vi.setSystemTime(NOW.plus({ minutes: 30 }).toJSDate());
      await advance(10 * 60 * 1000);
      expect(mocks.play).not.toHaveBeenCalled();
    });

    it("also works for offline users", async () => {
      mocks.user = { type: "offline" };
      mocks.events = [event("a", 10, [sound])];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);

      await advance(10 * 60 * 1000);
      expect(mocks.play).toHaveBeenCalledTimes(1);
      expect(mocks.post).not.toHaveBeenCalled();
    });

    it("stops the timers of notifications that were removed", async () => {
      mocks.events = [event("a", 10, [sound])];
      const view = render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);

      mocks.events = [event("a", 10, [])];
      view.rerender(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(11 * 60 * 1000);

      expect(mocks.play).not.toHaveBeenCalled();
    });
  });

  describe("push", () => {
    it("uploads the push times of each event", async () => {
      mocks.events = [event("a", 10, [all, sound]), event("b", 20, [all])];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(1000);

      expect(mocks.post).toHaveBeenCalledTimes(1);
      expect(mocks.post.mock.calls[0][0]).toBe("calendar/notifications/sync");
      expect(mocks.post.mock.calls[0][1]).toEqual({
        endpoint: "",
        events: [
          { id: "a", times: [{ at: NOW.plus({ minutes: 10 }).toMillis(), device: false }] },
          { id: "b", times: [{ at: NOW.plus({ minutes: 20 }).toMillis(), device: false }] },
        ],
      });
    });

    it("sends one upload at a time and only the latest of the queued ones", async () => {
      let finishFirst!: () => void;
      mocks.post.mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirst = () => resolve({ success: true, data: { retry: [] } });
        }),
      );
      mocks.events = [event("a", 10, [all])];
      const view = render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(0);

      for (const minutes of [20, 30]) {
        mocks.events = [event("a", minutes, [all])];
        view.rerender(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
        await advance(0);
      }
      expect(mocks.post).toHaveBeenCalledTimes(1);

      finishFirst();
      await advance(0);

      expect(mocks.post).toHaveBeenCalledTimes(2);
      expect(sentEvents(1)).toEqual([
        { id: "a", times: [{ at: NOW.plus({ minutes: 30 }).toMillis(), device: false }] },
      ]);
    });

    describe("changes from another device", () => {
      const remote = (e: CalendarEvent): CalendarEvent => ({ ...e, _remote: true });
      const renderService = () =>
        render(
          <SettingsStoreProvider>
            <NotificationService />
          </SettingsStoreProvider>,
        );

      it("leaves the upload to the device that made the change", async () => {
        mocks.events = [event("a", 10, [all])];
        const view = renderService();
        await advance(1000);
        mocks.post.mockClear();

        mocks.events = [remote(event("a", 20, [all]))];
        view.rerender(
          <SettingsStoreProvider>
            <NotificationService />
          </SettingsStoreProvider>,
        );
        await advance(5000);

        expect(mocks.post).not.toHaveBeenCalled();
      });

      it("does not upload an event that arrived from another device", async () => {
        mocks.events = [remote(event("a", 10, [all]))];
        renderService();
        await advance(5000);

        expect(mocks.post).not.toHaveBeenCalled();
      });

      it("uploads again after a local edit clears the remote mark", async () => {
        mocks.events = [remote(event("a", 10, [all]))];
        const view = renderService();
        await advance(1000);

        mocks.events = [event("a", 30, [all])];
        view.rerender(
          <SettingsStoreProvider>
            <NotificationService />
          </SettingsStoreProvider>,
        );
        await advance(1000);

        expect(mocks.post).toHaveBeenCalledTimes(1);
        expect(mocks.post.mock.calls[0][1].events[0].id).toBe("a");
      });

      it("forgets what it uploaded when another device clears the notifications", async () => {
        mocks.events = [event("a", 10, [all])];
        const view = renderService();
        await advance(1000);
        mocks.post.mockClear();
        const rerender = () =>
          view.rerender(
            <SettingsStoreProvider>
              <NotificationService />
            </SettingsStoreProvider>,
          );

        mocks.events = [remote(event("a", 10, []))];
        rerender();
        await advance(1000);
        expect(mocks.post).not.toHaveBeenCalled();

        mocks.events = [event("a", 10, [all])];
        rerender();
        await advance(1000);

        expect(mocks.post).toHaveBeenCalledTimes(1);
      });

      it("still uploads this device's own times", async () => {
        mocks.subscription = JSON.stringify({ endpoint: "https://push.example/x" });
        mocks.events = [remote(event("a", 10, [device]))];
        renderService();
        await advance(1000);

        expect(mocks.post).toHaveBeenCalledTimes(1);
      });

      it("replaces its own earlier times when the change removes them", async () => {
        mocks.subscription = JSON.stringify({ endpoint: "https://push.example/x" });
        mocks.events = [event("a", 10, [device])];
        const view = renderService();
        await advance(1000);
        mocks.post.mockClear();

        mocks.events = [remote(event("a", 10, [all]))];
        view.rerender(
          <SettingsStoreProvider>
            <NotificationService />
          </SettingsStoreProvider>,
        );
        await advance(1000);

        expect(mocks.post).toHaveBeenCalledTimes(1);
      });
    });

    it("uploads nothing when there are no push notifications", async () => {
      mocks.events = [event("a", 10, [sound])];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(5000);

      expect(mocks.post).not.toHaveBeenCalled();
    });

    it("targets this device with its push endpoint", async () => {
      mocks.subscription = JSON.stringify({ endpoint: "https://push.example/x" });
      mocks.events = [event("a", 10, [device])];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(1000);

      expect(mocks.post.mock.calls[0][1]).toEqual({
        endpoint: "https://push.example/x",
        events: [
          {
            id: "a",
            times: [{ at: NOW.plus({ minutes: 10 }).toMillis(), device: true }],
          },
        ],
      });
    });

    it("cannot target this device without a push subscription", async () => {
      mocks.events = [event("a", 10, [device])];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(5000);

      expect(mocks.post).not.toHaveBeenCalled();
    });

    it("does not upload for offline users", async () => {
      mocks.user = { type: "offline" };
      mocks.events = [event("a", 10, [all])];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(5000);

      expect(mocks.post).not.toHaveBeenCalled();
    });

    it("uploads only what changed", async () => {
      mocks.events = [event("a", 10, [all]), event("b", 20, [all])];
      const view = render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(1000);

      mocks.events = [event("a", 10, [all]), event("b", 30, [all])];
      view.rerender(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(1000);

      expect(mocks.post).toHaveBeenCalledTimes(2);
      expect(sentEvents(1)).toEqual([
        { id: "b", times: [{ at: NOW.plus({ minutes: 30 }).toMillis(), device: false }] },
      ]);
    });

    it("does not upload again when nothing changed", async () => {
      mocks.events = [event("a", 10, [all])];
      const view = render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(1000);

      mocks.events = [event("a", 10, [all])];
      view.rerender(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(5000);

      expect(mocks.post).toHaveBeenCalledTimes(1);
    });

    it("clears an event whose notifications were removed", async () => {
      mocks.events = [event("a", 10, [all])];
      const view = render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(1000);

      mocks.events = [event("a", 10, [])];
      view.rerender(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(1000);

      expect(sentEvents(1)).toEqual([{ id: "a", times: [] }]);
    });

    it("leaves the server alone when events disappear from the client", async () => {
      mocks.events = [event("a", 10, [all])];
      const view = render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(1000);

      mocks.events = [];
      view.rerender(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(5000);

      expect(mocks.post).toHaveBeenCalledTimes(1);
    });

    it("retries events the server could not fully store", async () => {
      mocks.post
        .mockResolvedValueOnce({ success: true, data: { retry: ["a"] } })
        .mockResolvedValue({ success: true, data: { retry: [] } });
      mocks.events = [event("a", 10, [all])];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(1000);
      expect(mocks.post).toHaveBeenCalledTimes(1);

      await advance(10 * 1000);
      await advance(1000);
      expect(mocks.post).toHaveBeenCalledTimes(2);
      expect(sentEvents(1)[0].id).toBe("a");
    });

    it("retries a failed upload at the next refresh", async () => {
      mocks.post
        .mockResolvedValueOnce({ success: false })
        .mockResolvedValue({ success: true, data: { retry: [] } });
      mocks.events = [event("a", 180, [all])];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(1000);
      expect(mocks.post).toHaveBeenCalledTimes(1);

      await advance(60 * 60 * 1000);
      await advance(1000);
      expect(mocks.post).toHaveBeenCalledTimes(2);
    });

    it("picks up occurrences that enter the 14 day window", async () => {
      const lateEvent = event("a", 14 * 24 * 60 + 30, [all]);
      mocks.events = [lateEvent];
      render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
      await advance(1000);
      expect(mocks.post).not.toHaveBeenCalled();

      await advance(60 * 60 * 1000);
      await advance(1000);
      expect(mocks.post).toHaveBeenCalledTimes(1);
    });
  });

  it("removes its timers when it unmounts", async () => {
    mocks.events = [event("a", 10, [sound, all])];
    const view = render(<SettingsStoreProvider><NotificationService /></SettingsStoreProvider>);
    await advance(0);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
