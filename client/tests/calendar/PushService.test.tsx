import { act, render } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PushService from "../../src/components/PushService.tsx";

const KEY = new Uint8Array([4, 1, 2, 3, 250, 251]);
const KEY_B64 = btoa(String.fromCharCode(...KEY))
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");
const ENDPOINT = "https://push.example/old";
const NEW_ENDPOINT = "https://push.example/new";
const INVALID =
  "Your push subscription is no longer valid, so push notifications were turned off. Enable them again in settings.";

const mocks = vi.hoisted(() => ({
  user: { type: "online" } as { type: string } | null,
  stored: null as string | null,
  vapid: "" as string,
  known: true,
  post: vi.fn(),
  set: vi.fn(),
  getSubscription: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  permission: "granted",
}));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ user: mocks.user }),
}));
vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({
    get: (key: string) => (key === "pushSubscription" ? mocks.stored : false),
    set: mocks.set,
  }),
}));
vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({
    post: mocks.post,
    serverMeta: { vapidPublicKey: mocks.vapid },
  }),
}));

const subscription = (extra: object = {}) => ({
  endpoint: ENDPOINT,
  expirationTime: null,
  options: { applicationServerKey: KEY.buffer },
  getKey: () => new Uint8Array([1, 2, 3]).buffer,
  unsubscribe: mocks.unsubscribe,
  ...extra,
});

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const calls = (path: string) =>
  mocks.post.mock.calls.filter(([called]) => called === path);

describe("PushService", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    mocks.user = { type: "online" };
    mocks.stored = JSON.stringify({ endpoint: ENDPOINT });
    mocks.vapid = KEY_B64;
    mocks.known = true;
    mocks.permission = "granted";
    mocks.post.mockReset().mockImplementation(async (path: string) => ({
      success: true,
      data: path === "user/push/check" ? { known: mocks.known } : undefined,
    }));
    mocks.set.mockReset();
    mocks.unsubscribe.mockReset();
    mocks.getSubscription.mockReset().mockResolvedValue(subscription());
    mocks.subscribe
      .mockReset()
      .mockImplementation(async () =>
        subscription({ endpoint: NEW_ENDPOINT, toJSON: () => ({ endpoint: NEW_ENDPOINT }) }),
      );
    vi.mocked(toast.error).mockClear();

    vi.stubGlobal("PushManager", class {});
    vi.stubGlobal("Notification", {
      requestPermission: async () => mocks.permission,
    });
    const registration = {
      update: () => {},
      pushManager: {
        getSubscription: mocks.getSubscription,
        subscribe: mocks.subscribe,
      },
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        controller: {},
        register: async () => registration,
        getRegistration: async () => registration,
      },
    });
  });

  afterEach(() => vi.useRealTimers());

  it("leaves a subscription alone that the server still knows", async () => {
    render(<PushService />);
    await flush();

    expect(calls("user/push/check")).toEqual([
      ["user/push/check", { endpoint: ENDPOINT }],
    ]);
    expect(calls("user/push/subscribe")).toHaveLength(0);
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("subscribes again when the server no longer has the subscription", async () => {
    mocks.known = false;
    render(<PushService />);
    await flush();

    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array(KEY),
    });
    expect(calls("user/push/subscribe")).toEqual([
      [
        "user/push/subscribe",
        { endpoint: NEW_ENDPOINT, p256dh: "AQID", auth: "AQID" },
      ],
    ]);
    expect(mocks.set).toHaveBeenCalledWith(
      "pushSubscription",
      JSON.stringify({ endpoint: NEW_ENDPOINT }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not subscribe again when the check itself fails", async () => {
    mocks.post.mockResolvedValue({ success: false });
    render(<PushService />);
    await flush();

    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  describe.each([
    ["the browser lost the subscription", () => null],
    [
      "the subscription has another endpoint",
      () => subscription({ endpoint: "https://push.example/other" }),
    ],
    ["the subscription expired", () => subscription({ expirationTime: Date.now() - 1 })],
    [
      "the server key only starts like the subscription key",
      () => subscription({ options: { applicationServerKey: KEY.slice(0, 3).buffer } }),
    ],
    [
      "the subscription was made for another server key",
      () => subscription({ options: { applicationServerKey: new Uint8Array([9, 9]).buffer } }),
    ],
  ])("when %s", (_, current) => {
    it("subscribes again without asking the server", async () => {
      mocks.getSubscription.mockResolvedValueOnce(current());
      render(<PushService />);
      await flush();

      expect(calls("user/push/check")).toHaveLength(0);
      expect(mocks.subscribe).toHaveBeenCalledTimes(1);
      expect(mocks.set).toHaveBeenCalledWith(
        "pushSubscription",
        JSON.stringify({ endpoint: NEW_ENDPOINT }),
      );
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe("when subscribing again fails", () => {
    beforeEach(() => {
      mocks.known = false;
    });

    it("turns push off and tells the user if permission was withdrawn", async () => {
      mocks.permission = "denied";
      render(<PushService />);
      await flush();

      expect(mocks.subscribe).not.toHaveBeenCalled();
      expect(mocks.set).toHaveBeenCalledWith("pushSubscription", null);
      expect(calls("user/push/unsubscribe")).toHaveLength(1);
      expect(toast.error).toHaveBeenCalledWith(INVALID);
    });

    it("turns push off and tells the user if the browser cannot subscribe", async () => {
      mocks.subscribe.mockRejectedValue(new Error("push service unavailable"));
      render(<PushService />);
      await flush();

      expect(mocks.set).toHaveBeenCalledWith("pushSubscription", null);
      expect(toast.error).toHaveBeenCalledWith(INVALID);
    });

    it("turns push off and tells the user if the server refuses the new subscription", async () => {
      mocks.post.mockImplementation(async (path: string) =>
        path === "user/push/check"
          ? { success: true, data: { known: false } }
          : { success: false },
      );
      render(<PushService />);
      await flush();

      expect(mocks.set).not.toHaveBeenCalledWith(
        "pushSubscription",
        expect.stringContaining("new"),
      );
      expect(mocks.set).toHaveBeenCalledWith("pushSubscription", null);
      expect(toast.error).toHaveBeenCalledWith(INVALID);
    });
  });

  it("keeps a subscription whose server key the browser does not expose", async () => {
    mocks.getSubscription.mockResolvedValue(
      subscription({ options: { applicationServerKey: null } }),
    );
    render(<PushService />);
    await flush();

    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(calls("user/push/check")).toHaveLength(1);
  });

  it("skips the server key check until the server key is known", async () => {
    mocks.vapid = "";
    mocks.getSubscription.mockResolvedValue(
      subscription({ options: { applicationServerKey: new Uint8Array([9, 9]).buffer } }),
    );
    render(<PushService />);
    await flush();

    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(calls("user/push/check")).toHaveLength(1);
  });

  it("does nothing while push is not enabled", async () => {
    mocks.stored = null;
    render(<PushService />);
    await flush();

    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.getSubscription).not.toHaveBeenCalled();
  });

  it("does nothing for offline users", async () => {
    mocks.user = { type: "offline" };
    render(<PushService />);
    await flush();

    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("checks again every hour and when the connection returns", async () => {
    render(<PushService />);
    await flush();
    expect(calls("user/push/check")).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(calls("user/push/check")).toHaveLength(2);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await flush();
    expect(calls("user/push/check")).toHaveLength(3);
  });

  it("stops checking when it unmounts", async () => {
    const view = render(<PushService />);
    await flush();
    view.unmount();

    await act(() => vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000));
    window.dispatchEvent(new Event("online"));
    await flush();

    expect(calls("user/push/check")).toHaveLength(1);
  });
});
