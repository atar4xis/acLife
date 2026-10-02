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
  importKeyPair: vi.fn(),
  unwrapKeyPairWithPin: vi.fn(),
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
  storageMock.data = { unlockMethod: "password", ...data };
};

const password = () => screen.findByLabelText("Password");

beforeEach(() => {
  userMock.user = onlineUser;
  userMock.setMasterKey.mockReset();
  userMock.setBucketKey.mockReset();
  userMock.logout.mockReset();
  apiMock.post.mockReset();
  cryptMock.importKeyPair.mockReset();
  cryptMock.unwrapKeyPairWithPin.mockReset();
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
      apiMock.post,
      storageMock,
      false,
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

  it("requests extractable keys when a PIN or stay-unlocked is configured", async () => {
    setStorage({ unlockMethod: "pin" });
    const user = userEvent.setup();
    render(<UnlockDialog />);

    // PIN mode without wrapped keys falls back to the password form
    await user.type(await password(), "secret");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(unlockMock.unlockAccount).toHaveBeenCalled());
    expect(unlockMock.unlockAccount.mock.calls[0][4]).toBe(true);
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

    expect(screen.queryByText("Decrypt Data")).not.toBeInTheDocument();

    userMock.user = null;
  });

  it("renders nothing until storage has loaded", () => {
    setStorage({}, false);
    render(<UnlockDialog />);

    expect(screen.queryByText("Decrypt Data")).not.toBeInTheDocument();
  });
});

describe("UnlockDialog stay-unlocked", () => {
  const unlockKeys = { masterKeyB64: "m", bucketKeyB64: "b" };

  it("unlocks automatically from the stored keys without showing the form", async () => {
    setStorage({ unlockMethod: "stay-unlocked", unlockKeys });
    cryptMock.importKeyPair.mockResolvedValue({ masterKey, bucketKey });
    render(<UnlockDialog />);

    await waitFor(() =>
      expect(userMock.setMasterKey).toHaveBeenCalledWith(masterKey),
    );
    expect(cryptMock.importKeyPair).toHaveBeenCalledWith("m", "b");
    expect(userMock.setBucketKey).toHaveBeenCalledWith(bucketKey);
    expect(screen.queryByText("Decrypt Data")).not.toBeInTheDocument();
  });

  it("falls back to the password form when the stored keys are unusable", async () => {
    setStorage({ unlockMethod: "stay-unlocked", unlockKeys });
    cryptMock.importKeyPair.mockRejectedValue(new Error("bad keys"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<UnlockDialog />);

    expect(await password()).toBeInTheDocument();
    expect(userMock.setMasterKey).not.toHaveBeenCalled();
  });

  it("shows the password form when no keys were stored", async () => {
    setStorage({ unlockMethod: "stay-unlocked", unlockKeys: null });
    render(<UnlockDialog />);

    expect(await password()).toBeInTheDocument();
    expect(cryptMock.importKeyPair).not.toHaveBeenCalled();
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
      "salt",
      "blob",
    );
    expect(userMock.setBucketKey).toHaveBeenCalledWith(bucketKey);
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
    expect(unlockMock.unlockAccount.mock.calls[0][4]).toBe(true);
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
