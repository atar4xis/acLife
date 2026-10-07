import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageData } from "../../src/types/Storage.ts";

const userMock = vi.hoisted(() => ({
  user: null as unknown,
  setMasterKey: vi.fn(),
  setBucketKey: vi.fn(),
  logout: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  ready: true,
  data: {} as Partial<StorageData>,
  get: (key: keyof StorageData) => storageMock.data[key],
  set: vi.fn(),
}));

const apiMock = vi.hoisted(() => ({ post: vi.fn() }));

const cryptMock = vi.hoisted(() => ({
  KeystoreUnavailableError: class KeystoreUnavailableError extends Error {},
  unwrapKeyPairWithPin: vi.fn(),
  restoreUnlockKeys: vi.fn(),
  MAX_PASSWORD_LENGTH: 256,
}));

const unlockMock = vi.hoisted(() => ({ unlockAccount: vi.fn() }));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => userMock,
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => storageMock,
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => apiMock,
}));

vi.mock("../../src/lib/crypt.ts", () => cryptMock);
vi.mock("../../src/lib/unlockAccount.ts", () => unlockMock);

import UnlockDialog from "../../src/components/login/UnlockDialog.tsx";

const onlineUser = { type: "online", uuid: "u1", envelopes: [] };
const masterKey = { id: "master" } as unknown as CryptoKey;
const bucketKey = { id: "bucket" } as unknown as CryptoKey;
const pinWrapped = { salt: "salt", encrypted: "blob" };

const setStorage = (data: Partial<StorageData>, ready = true) => {
  storageMock.ready = ready;
  storageMock.data = { unlockMethod: "password", pinFailures: 0, ...data };
};

const password = () => screen.findByLabelText("Password");

beforeEach(() => {
  userMock.user = onlineUser;
  userMock.setMasterKey.mockReset();
  userMock.setBucketKey.mockReset();
  userMock.logout.mockReset();
  apiMock.post.mockReset();
  cryptMock.unwrapKeyPairWithPin.mockReset();
  cryptMock.restoreUnlockKeys.mockReset();
  storageMock.set.mockReset();
  unlockMock.unlockAccount.mockReset();
  unlockMock.unlockAccount.mockResolvedValue({ masterKey, bucketKey });
  setStorage({});
});

describe("UnlockDialog password unlock", () => {
  it("unlocks with the password and hands the keys to the user context", async () => {
    const user = userEvent.setup();
    render(<UnlockDialog />);

    await user.type(await password(), "secret");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(userMock.setMasterKey).toHaveBeenCalledWith(masterKey),
    );
    expect(userMock.setBucketKey).toHaveBeenCalledWith(bucketKey);
    expect(unlockMock.unlockAccount).toHaveBeenCalledWith(
      "secret",
      onlineUser,
    );
    expect(screen.queryByText("Invalid password.")).not.toBeInTheDocument();
  });

  it("shows an error and keeps the data locked on a wrong password", async () => {
    unlockMock.unlockAccount.mockRejectedValue(new Error("Invalid password."));
    const user = userEvent.setup();
    render(<UnlockDialog />);

    await user.type(await password(), "wrong");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Invalid password.")).toBeInTheDocument();
    expect(userMock.setMasterKey).not.toHaveBeenCalled();
  });

  it("lets the user log out instead", async () => {
    const user = userEvent.setup();
    render(<UnlockDialog />);

    await user.click(await screen.findByRole("button", { name: "Log out" }));

    expect(userMock.logout).toHaveBeenCalled();
  });
});

describe("UnlockDialog visibility", () => {
  it("renders nothing without an online user", () => {
    userMock.user = { type: "offline" };
    render(<UnlockDialog />);

    expect(screen.queryByText("Decrypt data")).not.toBeInTheDocument();

    userMock.user = null;
  });

  it("renders nothing until storage has loaded", () => {
    setStorage({}, false);
    render(<UnlockDialog />);

    expect(screen.queryByText("Decrypt data")).not.toBeInTheDocument();
  });
});

describe("UnlockDialog stay-unlocked", () => {
  it("unlocks automatically from the stored keys without showing the form", async () => {
    setStorage({
      unlockMethod: "stay-unlocked",
      unlockKeys: { masterKey, bucketKey },
    });
    cryptMock.restoreUnlockKeys.mockResolvedValue({ masterKey, bucketKey });
    render(<UnlockDialog />);

    await waitFor(() =>
      expect(userMock.setMasterKey).toHaveBeenCalledWith(masterKey),
    );
    expect(userMock.setBucketKey).toHaveBeenCalledWith(bucketKey);
    expect(cryptMock.restoreUnlockKeys).toHaveBeenCalledWith({
      masterKey,
      bucketKey,
    });
    expect(screen.queryByText("Decrypt data")).not.toBeInTheDocument();
  });

  it("shows the password form when no keys were stored", async () => {
    setStorage({ unlockMethod: "stay-unlocked", unlockKeys: null });
    render(<UnlockDialog />);

    expect(await password()).toBeInTheDocument();
    expect(userMock.setMasterKey).not.toHaveBeenCalled();
  });

  it("shows the password form when the stored keys are in the old format", async () => {
    setStorage({
      unlockMethod: "stay-unlocked",
      unlockKeys: { masterKeyB64: "m", bucketKeyB64: "b" } as never,
    });
    cryptMock.restoreUnlockKeys.mockRejectedValue(new Error("invalid"));
    render(<UnlockDialog />);

    expect(await password()).toBeInTheDocument();
    expect(userMock.setMasterKey).not.toHaveBeenCalled();
    expect(storageMock.set).toHaveBeenCalledWith("unlockKeys", null);
  });

  it("keeps the stored keys when the keystore is unavailable", async () => {
    setStorage({
      unlockMethod: "stay-unlocked",
      unlockKeys: { encrypted: "blob" },
    });
    cryptMock.restoreUnlockKeys.mockRejectedValue(
      new cryptMock.KeystoreUnavailableError(),
    );
    render(<UnlockDialog />);

    expect(await password()).toBeInTheDocument();
    expect(screen.getByText(/system keystore/)).toBeInTheDocument();
    expect(storageMock.set).not.toHaveBeenCalledWith("unlockKeys", null);
  });
});

describe("UnlockDialog PIN", () => {
  beforeEach(() => {
    setStorage({ unlockMethod: "pin", pinWrappedKeys: pinWrapped });
  });

  it("shows the PIN form first and unlocks with the right PIN", async () => {
    cryptMock.unwrapKeyPairWithPin.mockResolvedValue({ masterKey, bucketKey });
    const user = userEvent.setup();
    render(<UnlockDialog />);

    await user.type(await screen.findByLabelText("PIN code"), "1234");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(userMock.setMasterKey).toHaveBeenCalledWith(masterKey),
    );
    expect(cryptMock.unwrapKeyPairWithPin).toHaveBeenCalledWith(
      "1234",
      pinWrapped,
    );
    expect(userMock.setBucketKey).toHaveBeenCalledWith(bucketKey);
    expect(storageMock.set).toHaveBeenLastCalledWith("pinFailures", 0);
  });

  it("stores the upgraded blob after unlocking", async () => {
    const upgraded = { salt: "s", encrypted: "e", keystore: true as const };
    cryptMock.unwrapKeyPairWithPin.mockResolvedValue({
      masterKey,
      bucketKey,
      upgraded,
    });
    const user = userEvent.setup();
    render(<UnlockDialog />);

    await user.type(await screen.findByLabelText("PIN code"), "1234");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(storageMock.set).toHaveBeenCalledWith("pinWrappedKeys", upgraded),
    );
  });

  it("removes the PIN and asks for the password when the keystore is unavailable", async () => {
    storageMock.set.mockImplementation((key: keyof StorageData, value) => {
      (storageMock.data as Record<string, unknown>)[key] = value;
    });
    cryptMock.unwrapKeyPairWithPin.mockRejectedValue(
      new cryptMock.KeystoreUnavailableError(),
    );
    const user = userEvent.setup();
    render(<UnlockDialog />);

    await user.type(await screen.findByLabelText("PIN code"), "1111");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/system keystore/)).toBeInTheDocument();
    expect(await password()).toHaveValue("");
    expect(storageMock.data.pinWrappedKeys).toBeNull();
    expect(storageMock.data.unlockKeys).toBeNull();
    expect(storageMock.data.unlockMethod).toBe("password");
    expect(storageMock.data.pinFailures).toBe(0);
    expect(screen.queryByText(/PIN was removed/)).not.toBeInTheDocument();
    storageMock.set.mockReset();
  });

  it("removes the PIN after three wrong attempts", async () => {
    storageMock.set.mockImplementation((key: keyof StorageData, value) => {
      (storageMock.data as Record<string, unknown>)[key] = value;
    });
    cryptMock.unwrapKeyPairWithPin.mockRejectedValue(new Error("bad pin"));
    const user = userEvent.setup();
    render(<UnlockDialog />);

    for (const attempt of ["1111", "2222"]) {
      await user.type(await screen.findByLabelText("PIN code"), attempt);
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByText("Invalid PIN.");
      await user.clear(screen.getByLabelText("PIN code"));
    }
    expect(storageMock.data.pinWrappedKeys).not.toBeNull();

    await user.type(screen.getByLabelText("PIN code"), "3333");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/PIN was removed/)).toBeInTheDocument();
    expect(await password()).toHaveValue("");
    expect(storageMock.data.pinWrappedKeys).toBeNull();
    expect(storageMock.data.unlockKeys).toBeNull();
    expect(storageMock.data.unlockMethod).toBe("password");
    storageMock.set.mockReset();
  });

  it("shows an error for a wrong PIN", async () => {
    cryptMock.unwrapKeyPairWithPin.mockRejectedValue(new Error("bad pin"));
    const user = userEvent.setup();
    render(<UnlockDialog />);

    await user.type(await screen.findByLabelText("PIN code"), "0000");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Invalid PIN.")).toBeInTheDocument();
    expect(userMock.setMasterKey).not.toHaveBeenCalled();
  });

  it("switches between PIN and password and clears the error", async () => {
    cryptMock.unwrapKeyPairWithPin.mockRejectedValue(new Error("bad pin"));
    const user = userEvent.setup();
    render(<UnlockDialog />);

    await user.type(await screen.findByLabelText("PIN code"), "0000");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Invalid PIN.");

    await user.click(
      screen.getByRole("button", { name: "Use password instead" }),
    );
    expect(await password()).toBeInTheDocument();
    expect(screen.queryByText("Invalid PIN.")).not.toBeInTheDocument();
    expect(screen.queryByText("Invalid password.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use PIN instead" }));
    expect(screen.queryByText("Invalid PIN.")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("PIN code")).toBeInTheDocument();
  });

  it("can still unlock with the password when a PIN is set up", async () => {
    const user = userEvent.setup();
    render(<UnlockDialog />);

    await user.click(
      await screen.findByRole("button", { name: "Use password instead" }),
    );
    await user.type(await password(), "secret");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(userMock.setMasterKey).toHaveBeenCalledWith(masterKey),
    );
  });

  it("offers the PIN option for the password method once PIN keys exist", async () => {
    setStorage({ unlockMethod: "password", pinWrappedKeys: pinWrapped });
    render(<UnlockDialog />);

    expect(await password()).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use PIN instead" }),
    ).toBeInTheDocument();
  });
});
