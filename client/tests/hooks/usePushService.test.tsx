import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  set: vi.fn(),
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({
    serverMeta: { vapidPublicKey: "AAAA" },
    post: mocks.post,
  }),
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ get: () => null, set: mocks.set }),
}));

import { usePushService } from "../../src/hooks/usePushService.ts";

const subscription = {
  endpoint: "https://push.example/abc",
  getKey: () => new ArrayBuffer(8),
  unsubscribe: vi.fn(),
};

beforeEach(() => {
  mocks.post.mockReset();
  mocks.set.mockReset();
  subscription.unsubscribe.mockReset();
  vi.stubGlobal("Notification", { requestPermission: async () => "granted" });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      controller: {},
      register: async () => ({
        pushManager: {
          getSubscription: async () => null,
          subscribe: async () => subscription,
        },
      }),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

const enable = () => renderHook(() => usePushService()).result.current.enable();

describe("usePushService enable", () => {
  it("stores the subscription once the server accepts it", async () => {
    mocks.post.mockResolvedValue({ success: true });

    await enable();

    expect(mocks.post).toHaveBeenCalledWith(
      "user/push/subscribe",
      expect.objectContaining({ endpoint: subscription.endpoint }),
    );
    expect(mocks.set).toHaveBeenCalledWith(
      "pushSubscription",
      expect.any(String),
    );
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it("fails with the translated message when the device limit is reached", async () => {
    mocks.post.mockResolvedValue({
      success: false,
      code: "push_subscription_limit_reached",
      message:
        "Push device limit reached. Turn off push on another device and try again.",
    });

    await expect(enable()).rejects.toBe(
      "Push device limit reached. Turn off push on another device and try again.",
    );
    expect(mocks.set).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it("falls back to the generic message without a server message", async () => {
    mocks.post.mockResolvedValue({ success: false });

    await expect(enable()).rejects.toBe(
      "Something went wrong. Please try again later.",
    );
    expect(mocks.set).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it("drops the replaced subscription on the server too", async () => {
    const old = { endpoint: "https://push.example/old", unsubscribe: vi.fn() };
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: {},
        register: async () => ({
          pushManager: {
            getSubscription: async () => old,
            subscribe: async () => subscription,
          },
        }),
      },
    });
    mocks.post.mockResolvedValue({ success: true });

    await enable();

    expect(mocks.post).toHaveBeenCalledWith("user/push/unsubscribe", {
      endpoint: old.endpoint,
    });
    expect(old.unsubscribe).toHaveBeenCalledOnce();
  });
});
