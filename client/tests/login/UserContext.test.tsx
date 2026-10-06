import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageData } from "../../src/types/Storage.ts";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  setPendingVerificationEmail: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  data: {} as Partial<StorageData>,
  get: vi.fn(),
  set: vi.fn(),
}));

const unlockMock = vi.hoisted(() => ({ unlockAccount: vi.fn() }));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => apiMock,
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => storageMock,
}));

vi.mock("../../src/lib/unlockAccount.ts", () => unlockMock);

import { UserProvider, useUser } from "../../src/context/UserContext.tsx";

const onlineUser = {
  uuid: "u1",
  email: "user@example.com",
  envelopes: [],
  subscription_status: null,
};

const masterKey = { id: "master" } as unknown as CryptoKey;
const bucketKey = { id: "bucket" } as unknown as CryptoKey;

let ctx: ReturnType<typeof useUser>;

function Probe() {
  ctx = useUser();
  return null;
}

const renderProvider = () =>
  render(
    <UserProvider>
      <Probe />
    </UserProvider>,
  );

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.setPendingVerificationEmail.mockReset();
  unlockMock.unlockAccount.mockReset();
  storageMock.set.mockReset();
  storageMock.data = { unlockMethod: "password" };
  storageMock.get.mockImplementation(
    (key: keyof StorageData) => storageMock.data[key],
  );
  apiMock.get.mockResolvedValue({ success: true, data: onlineUser });
  unlockMock.unlockAccount.mockResolvedValue({ masterKey, bucketKey });
});

describe("UserProvider.checkLogin", () => {
  it("stores the online user without unlocking when no password is given", async () => {
    renderProvider();

    await act(() => ctx.checkLogin());

    expect(ctx.user).toEqual({ ...onlineUser, type: "online" });
    expect(ctx.masterKey).toBeNull();
    expect(unlockMock.unlockAccount).not.toHaveBeenCalled();
    expect(apiMock.setPendingVerificationEmail).toHaveBeenCalledWith(null);
  });

  it("unlocks with the password and exposes the keys", async () => {
    renderProvider();

    await act(() => ctx.checkLogin("pw"));

    expect(unlockMock.unlockAccount).toHaveBeenCalledWith(
      "pw",
      expect.objectContaining({ uuid: "u1" }),
      false,
    );
    expect(ctx.masterKey).toBe(masterKey);
    expect(ctx.bucketKey).toBe(bucketKey);
    expect(ctx.isUnlocking).toBe(false);
  });

  it.each([
    ["password", false],
    ["pin", true],
    ["stay-unlocked", true],
  ] as const)(
    "requests extractable keys for the %s unlock method: %s",
    async (method, exportable) => {
      storageMock.data = { unlockMethod: method };
      renderProvider();

      await act(() => ctx.checkLogin("pw"));

      expect(unlockMock.unlockAccount.mock.calls[0][2]).toBe(exportable);
    },
  );

  it("keeps the user but clears the keys when unlocking fails", async () => {
    unlockMock.unlockAccount.mockRejectedValue(new Error("Invalid password."));
    renderProvider();

    await act(() => ctx.checkLogin("bad"));

    expect(ctx.user?.type).toBe("online");
    expect(ctx.masterKey).toBeNull();
    expect(ctx.bucketKey).toBeNull();
    expect(ctx.isUnlocking).toBe(false);
  });

  it("drops previously unlocked keys when a later unlock fails", async () => {
    renderProvider();
    await act(() => ctx.checkLogin("pw"));
    expect(ctx.masterKey).toBe(masterKey);

    unlockMock.unlockAccount.mockRejectedValue(new Error("Invalid password."));
    await act(() => ctx.checkLogin("bad"));

    expect(ctx.user?.type).toBe("online");
    expect(ctx.masterKey).toBeNull();
    expect(ctx.bucketKey).toBeNull();
  });

  it("reports isUnlocking while the keys are being derived", async () => {
    let resolve!: (keys: unknown) => void;
    unlockMock.unlockAccount.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderProvider();

    let pending!: Promise<unknown>;
    act(() => {
      pending = ctx.checkLogin("pw") as Promise<unknown>;
    });
    await waitFor(() => expect(ctx.isUnlocking).toBe(true));

    await act(async () => {
      resolve({ masterKey, bucketKey });
      await pending;
    });

    expect(ctx.isUnlocking).toBe(false);
    expect(ctx.masterKey).toBe(masterKey);
  });

  it("clears the user and keys when the session is gone", async () => {
    renderProvider();
    await act(() => ctx.checkLogin("pw"));
    expect(ctx.masterKey).toBe(masterKey);

    apiMock.get.mockResolvedValue({ success: false });
    await act(() => ctx.checkLogin());

    expect(ctx.user).toBeNull();
    await waitFor(() => expect(ctx.masterKey).toBeNull());
    expect(ctx.bucketKey).toBeNull();
  });
});

describe("UserProvider.logout", () => {
  it("logs out, resets the stored unlock state and re-checks the session", async () => {
    apiMock.post.mockResolvedValue({ success: true });
    apiMock.get.mockResolvedValue({ success: false });
    renderProvider();

    await act(async () => {
      await ctx.logout();
    });

    expect(apiMock.post).toHaveBeenCalledWith("auth/logout", null);
    expect(storageMock.set).toHaveBeenCalledWith("unlockMethod", "password");
    expect(storageMock.set).toHaveBeenCalledWith("unlockKeys", null);
    expect(storageMock.set).toHaveBeenCalledWith("pinWrappedKeys", null);
    expect(apiMock.get).toHaveBeenCalledWith("user");
    expect(ctx.user).toBeNull();
  });
});
