import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageData } from "../../src/types/Storage.ts";

const userMock = vi.hoisted(() => ({
  user: { type: "online" } as { type: string } | null,
  masterKey: {} as CryptoKey | null,
  setMasterKey: vi.fn(),
  setBucketKey: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  data: {} as Partial<StorageData>,
  get: (key: keyof StorageData) => storageMock.data[key],
}));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => userMock,
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => storageMock,
}));

import AutoLockService from "../../src/components/AutoLockService.tsx";

const MINUTE = 60 * 1000;

const setup = (data: Partial<StorageData>) => {
  storageMock.data = { unlockMethod: "password", ...data };
  return render(<AutoLockService />);
};

const expectLocked = () => {
  expect(userMock.setMasterKey).toHaveBeenCalledWith(null);
  expect(userMock.setBucketKey).toHaveBeenCalledWith(null);
};

beforeEach(() => {
  vi.useFakeTimers();
  userMock.user = { type: "online" };
  userMock.masterKey = {} as CryptoKey;
  userMock.setMasterKey.mockReset();
  userMock.setBucketKey.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AutoLockService timers", () => {
  it("locks after the configured idle time", () => {
    setup({ autoLock: "5m" });

    act(() => vi.advanceTimersByTime(5 * MINUTE - 1));
    expect(userMock.setMasterKey).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expectLocked();
  });

  it.each([
    ["10m", 10],
    ["15m", 15],
    ["30m", 30],
    ["45m", 45],
    ["1h", 60],
  ] as const)("uses the %s duration", (option, minutes) => {
    setup({ autoLock: option });

    act(() => vi.advanceTimersByTime(minutes * MINUTE));

    expectLocked();
  });

  it("restarts the timer on user activity", () => {
    setup({ autoLock: "5m" });

    act(() => vi.advanceTimersByTime(4 * MINUTE));
    act(() => {
      window.dispatchEvent(new Event("mousemove"));
    });
    act(() => vi.advanceTimersByTime(4 * MINUTE));
    expect(userMock.setMasterKey).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(MINUTE));
    expectLocked();
  });

  it("stops listening and timing after unmount", () => {
    const { unmount } = setup({ autoLock: "5m" });

    unmount();
    act(() => {
      window.dispatchEvent(new Event("mousemove"));
      vi.advanceTimersByTime(10 * MINUTE);
    });

    expect(userMock.setMasterKey).not.toHaveBeenCalled();
  });
});

describe("AutoLockService focus mode", () => {
  it("locks when the window loses focus", () => {
    setup({ autoLock: "focus" });

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expectLocked();
  });

  it("stops listening for blur after unmount", () => {
    const { unmount } = setup({ autoLock: "focus" });

    unmount();
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(userMock.setMasterKey).not.toHaveBeenCalled();
  });

  it("locks when the tab becomes hidden", () => {
    setup({ autoLock: "focus" });

    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expectLocked();
  });

  it("stays unlocked while the tab is visible", () => {
    setup({ autoLock: "focus" });

    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(userMock.setMasterKey).not.toHaveBeenCalled();
  });
});

describe("AutoLockService inactive states", () => {
  const expectNeverLocks = () => {
    act(() => {
      window.dispatchEvent(new Event("blur"));
      vi.advanceTimersByTime(2 * 60 * MINUTE);
    });
    expect(userMock.setMasterKey).not.toHaveBeenCalled();
  };

  it("does nothing when auto-lock is disabled", () => {
    setup({ autoLock: "disabled" });
    expectNeverLocks();
  });

  it("does nothing with the stay-unlocked method", () => {
    setup({ autoLock: "focus", unlockMethod: "stay-unlocked" });
    expectNeverLocks();
  });

  it("does nothing while the data is already locked", () => {
    userMock.masterKey = null;
    setup({ autoLock: "5m" });
    expectNeverLocks();
  });

  it("does nothing for offline users", () => {
    userMock.user = { type: "offline" };
    setup({ autoLock: "5m" });
    expectNeverLocks();
  });
});
