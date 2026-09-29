import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageData } from "../../src/types/Storage.ts";

const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    version: 0,
    data: {} as Partial<StorageData>,
    listeners,
    set: vi.fn(),
    reset(data: Partial<StorageData>) {
      this.data = data;
      this.version++;
    },
  };
});

const userMock = vi.hoisted(() => ({
  user: null as unknown,
  masterKey: null as unknown,
  bucketKey: null as unknown,
}));

const apiMock = vi.hoisted(() => ({ post: vi.fn() }));

const cryptMock = vi.hoisted(() => ({
  exportKeyPair: vi.fn(),
  wrapKeyPairWithPin: vi.fn(),
}));

const unlockMock = vi.hoisted(() => ({ unlockAccount: vi.fn() }));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => {
    useSyncExternalStore(
      (cb) => {
        store.listeners.add(cb);
        return () => store.listeners.delete(cb);
      },
      () => store.version,
    );
    return {
      ready: true,
      get: (key: keyof StorageData) => store.data[key],
      set: store.set,
    };
  },
}));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => userMock,
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => apiMock,
}));

vi.mock("../../src/lib/crypt.ts", () => cryptMock);
vi.mock("../../src/lib/unlockAccount.ts", () => unlockMock);

import {
  SecuritySettingsProvider,
  useSecuritySettings,
} from "../../src/context/SecuritySettingsContext.tsx";

const onlineUser = { type: "online", uuid: "u1", envelopes: [] };
const exported = { masterKeyB64: "mk", bucketKeyB64: "bk" };
const wrapped = { salt: "s", encrypted: "e" };

function Consumer() {
  const { unlockMethod, autoLock, setUnlockMethod, setAutoLock } =
    useSecuritySettings();

  return (
    <div>
      <span data-testid="method">{unlockMethod}</span>
      <span data-testid="auto-lock">{autoLock}</span>
      <button onClick={() => setUnlockMethod("password")}>password</button>
      <button onClick={() => setUnlockMethod("pin")}>pin</button>
      <button onClick={() => setUnlockMethod("stay-unlocked")}>stay</button>
      <button onClick={() => setAutoLock("5m")}>lock-5m</button>
    </div>
  );
}

const renderProvider = () =>
  render(
    <SecuritySettingsProvider>
      <Consumer />
    </SecuritySettingsProvider>,
  );

// the storage mock applies writes so the provider re-renders like the real one
const applyWrites = () => {
  store.set.mockImplementation((key: keyof StorageData, value: never) => {
    store.data = { ...store.data, [key]: value };
    store.version++;
    store.listeners.forEach((cb) => cb());
  });
};

const dialogInputs = () =>
  within(screen.getByRole("dialog")).getAllByDisplayValue(
    "",
  ) as HTMLInputElement[];

beforeEach(() => {
  store.set.mockReset();
  applyWrites();
  store.reset({ unlockMethod: "password", autoLock: "disabled" });
  userMock.user = onlineUser;
  userMock.masterKey = {};
  userMock.bucketKey = {};
  apiMock.post.mockReset();
  cryptMock.exportKeyPair.mockReset().mockResolvedValue(exported);
  cryptMock.wrapKeyPairWithPin.mockReset().mockResolvedValue(wrapped);
  unlockMock.unlockAccount
    .mockReset()
    .mockResolvedValue({ masterKey: {}, bucketKey: {} });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("SecuritySettingsProvider values", () => {
  it("exposes the stored unlock method and auto-lock", () => {
    store.reset({ unlockMethod: "pin", autoLock: "15m" });
    renderProvider();

    expect(screen.getByTestId("method")).toHaveTextContent("pin");
    expect(screen.getByTestId("auto-lock")).toHaveTextContent("15m");
  });

  it("persists an auto-lock change", async () => {
    renderProvider();

    await userEvent.click(screen.getByText("lock-5m"));

    expect(store.set).toHaveBeenCalledWith("autoLock", "5m");
    expect(screen.getByTestId("auto-lock")).toHaveTextContent("5m");
  });

  it("forces auto-lock off when stay-unlocked is active", () => {
    store.reset({ unlockMethod: "stay-unlocked", autoLock: "5m" });
    renderProvider();

    expect(store.set).toHaveBeenCalledWith("autoLock", "disabled");
  });
});

describe("switching back to the password method", () => {
  it("clears the stored keys and saves the method", async () => {
    store.reset({ unlockMethod: "pin", autoLock: "disabled" });
    renderProvider();

    await userEvent.click(screen.getByText("password"));

    await waitFor(() =>
      expect(store.set).toHaveBeenCalledWith("unlockMethod", "password"),
    );
    expect(store.set).toHaveBeenCalledWith("unlockKeys", null);
    expect(store.set).toHaveBeenCalledWith("pinWrappedKeys", null);
    expect(unlockMock.unlockAccount).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Security settings updated.");
  });

  it("reports a storage failure and leaves the method unchanged", async () => {
    store.reset({ unlockMethod: "pin", autoLock: "disabled" });
    store.set.mockImplementation(() => {
      throw new Error("disk full");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderProvider();

    await userEvent.click(screen.getByText("password"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to update security settings.",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("method")).toHaveTextContent("pin");
  });

  it("refuses while the data is still encrypted", async () => {
    userMock.masterKey = null;
    store.reset({ unlockMethod: "pin", autoLock: "disabled" });
    renderProvider();

    await userEvent.click(screen.getByText("password"));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      "Your data must be decrypted to change this setting.",
    );
    expect(store.set).not.toHaveBeenCalledWith("unlockMethod", "password");
  });

  it("does nothing for offline users", async () => {
    userMock.user = { type: "offline" };
    store.reset({ unlockMethod: "pin", autoLock: "disabled" });
    renderProvider();

    await userEvent.click(screen.getByText("password"));

    expect(store.set).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("enabling stay-unlocked", () => {
  it("opens the dialog without changing anything yet", async () => {
    renderProvider();

    await userEvent.click(screen.getByText("stay"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(store.set).not.toHaveBeenCalled();
  });

  it("stores the exported keys after the password is confirmed", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByText("stay"));
    await user.type(dialogInputs()[0], "my-password");
    await user.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() =>
      expect(store.set).toHaveBeenCalledWith("unlockMethod", "stay-unlocked"),
    );
    expect(unlockMock.unlockAccount).toHaveBeenCalledWith(
      "my-password",
      onlineUser,
      apiMock.post,
      undefined,
      true,
    );
    expect(store.set).toHaveBeenCalledWith("unlockKeys", exported);
    expect(store.set).toHaveBeenCalledWith("pinWrappedKeys", null);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("requires the current password", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByText("stay"));
    await user.click(await screen.findByRole("button", { name: "Enable" }));

    expect(
      await screen.findByText("Please enter your current password."),
    ).toBeInTheDocument();
    expect(unlockMock.unlockAccount).not.toHaveBeenCalled();
  });

  it("shows the error and stores nothing when the password is wrong", async () => {
    unlockMock.unlockAccount.mockRejectedValue(new Error("Invalid password."));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByText("stay"));
    await user.type(dialogInputs()[0], "wrong");
    await user.click(screen.getByRole("button", { name: "Enable" }));

    expect(await screen.findByText("Invalid password.")).toBeInTheDocument();
    expect(store.set).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes the dialog on cancel", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByText("stay"));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(store.set).not.toHaveBeenCalled();
  });
});

describe("setting up a PIN", () => {
  const fillPinForm = async (
    user: ReturnType<typeof userEvent.setup>,
    pin: string,
    confirm: string,
    password: string,
  ) => {
    await user.click(screen.getByText("pin"));
    const [pinInput, confirmInput, passwordInput] = dialogInputs();
    await user.type(pinInput, pin);
    await user.type(confirmInput, confirm);
    if (password) await user.type(passwordInput, password);
    await user.click(screen.getByRole("button", { name: "Set PIN" }));
  };

  it("wraps the exported keys with the PIN and drops any stay-unlocked keys", async () => {
    const user = userEvent.setup();
    renderProvider();

    await fillPinForm(user, "1234", "1234", "my-password");

    await waitFor(() =>
      expect(store.set).toHaveBeenCalledWith("unlockMethod", "pin"),
    );
    expect(cryptMock.wrapKeyPairWithPin).toHaveBeenCalledWith(
      "1234",
      "mk",
      "bk",
    );
    expect(store.set).toHaveBeenCalledWith("pinWrappedKeys", wrapped);
    expect(store.set).toHaveBeenCalledWith("unlockKeys", null);
    expect(unlockMock.unlockAccount.mock.calls[0][0]).toBe("my-password");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("closes the dialog on cancel without saving", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByText("pin"));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(store.set).not.toHaveBeenCalled();
  });

  it.each([
    ["12", "12", "pw", "PIN must be 4 to 16 digits."],
    ["1234", "4321", "pw", "PINs do not match."],
    ["1234", "1234", "", "Please enter your current password."],
  ])(
    "rejects pin=%s confirm=%s password=%s",
    async (pin, confirm, pw, message) => {
      const user = userEvent.setup();
      renderProvider();

      await fillPinForm(user, pin, confirm, pw);

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(cryptMock.wrapKeyPairWithPin).not.toHaveBeenCalled();
      expect(store.set).not.toHaveBeenCalled();
    },
  );

  it("ignores non-digit characters in the PIN fields", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByText("pin"));
    const [pinInput] = dialogInputs();
    await user.type(pinInput, "1a2b3c4");

    expect(pinInput).toHaveValue("1234");
  });

  it("strips non-digits from the confirmation field too", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByText("pin"));
    const [, confirmInput] = dialogInputs();
    await user.type(confirmInput, "1a2b");

    expect(confirmInput).toHaveValue("12");
  });

  it("shows the error and stores nothing when the password is wrong", async () => {
    unlockMock.unlockAccount.mockRejectedValue(new Error("Invalid password."));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderProvider();

    await fillPinForm(user, "1234", "1234", "wrong");

    expect(await screen.findByText("Invalid password.")).toBeInTheDocument();
    expect(store.set).not.toHaveBeenCalled();
  });
});

describe("dialog lifecycle", () => {
  it("clears every PIN field when the dialog is reopened", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByText("pin"));
    const inputs = within(
      await screen.findByRole("dialog"),
    ).getAllByDisplayValue("");
    await user.type(inputs[0], "1234");
    await user.type(inputs[1], "5678");
    await user.type(inputs[2], "secret");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByText("pin"));
    await screen.findByRole("dialog");

    for (const input of dialogInputs()) expect(input).toHaveValue("");
  });

  it("resets the form when the dialog is reopened", async () => {
    const user = userEvent.setup();
    renderProvider();

    await user.click(screen.getByText("stay"));
    await user.type(dialogInputs()[0], "typed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByText("stay"));

    await screen.findByRole("dialog");
    expect(dialogInputs()[0]).toHaveValue("");
  });
});

describe("useSecuritySettings", () => {
  it("throws outside of the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Consumer />)).toThrow(
      "useSecuritySettings must be used within a SecuritySettingsProvider",
    );
  });
});
