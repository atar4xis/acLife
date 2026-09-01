import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMetadata } from "../../src/types/ServerMetadata.ts";

const apiMock = vi.hoisted(() => ({
  setUrl: vi.fn(),
  post: vi.fn(),
  serverMeta: null as ServerMetadata | null,
}));

const userMock = vi.hoisted(() => ({
  setUser: vi.fn(),
  setMasterKey: vi.fn(),
  checkLogin: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

const cryptMock = vi.hoisted(() => ({
  deriveMasterKey: vi.fn(),
  encrypt: vi.fn(),
  generateSRPTriplet: vi.fn(),
  randomBytes: vi.fn(),
  SRP_CheckM2: vi.fn(),
}));

const srpMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  generateSalt: vi.fn(),
}));

const srpClientMock = vi.hoisted(() => ({
  A: Uint8Array.from([1, 2, 3]),
  M1: Uint8Array.from([4, 5, 6]),
  setB: vi.fn(),
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({
    url: "https://mock.example/api/",
    setUrl: apiMock.setUrl,
    get: vi.fn(),
    getRaw: vi.fn(),
    post: apiMock.post,
    query: vi.fn(),
    serverMeta: apiMock.serverMeta,
    setServerMeta: vi.fn(),
    pendingLogout: false,
    setPendingLogout: vi.fn(),
  }),
}));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => userMock,
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => storageMock,
}));

vi.mock("../../src/lib/crypt.ts", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/crypt.ts")>(
    "../../src/lib/crypt.ts",
  );

  return {
    ...actual,
    deriveMasterKey: cryptMock.deriveMasterKey,
    encrypt: cryptMock.encrypt,
    generateSRPTriplet: cryptMock.generateSRPTriplet,
    randomBytes: cryptMock.randomBytes,
    SRP_CheckM2: cryptMock.SRP_CheckM2,
  };
});

vi.mock("@mzattahri/srp", async () => {
  const actual = await vi.importActual<typeof import("@mzattahri/srp")>(
    "@mzattahri/srp",
  );

  return {
    ...actual,
    Client: {
      initialize: srpMock.initialize,
    },
    generateSalt: srpMock.generateSalt,
  };
});

import LoginDialog from "../../src/components/login/LoginDialog.tsx";

const defaultServerMeta: ServerMetadata = {
  url: "https://api.example.com/acLife/api",
  policies: {},
  registration: {
    enabled: true,
    subscriptionRequired: false,
    email: {
      verificationRequired: false,
      domainBlacklist: [],
    },
  },
  vapidPublicKey: "test-vapid-key",
};

const renderLoginDialog = () => render(<LoginDialog />);

const openRegistrationForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /create account/i }));

  expect(await screen.findByLabelText(/confirm password/i)).toBeInTheDocument();
};

beforeEach(() => {
  apiMock.serverMeta = null;
  apiMock.setUrl.mockReset();
  apiMock.post.mockReset();

  userMock.setUser.mockReset();
  userMock.setMasterKey.mockReset();
  userMock.checkLogin.mockReset().mockResolvedValue(undefined);

  storageMock.get.mockReset().mockReturnValue("");
  storageMock.set.mockReset();

  cryptMock.deriveMasterKey.mockReset().mockResolvedValue({} as CryptoKey);
  cryptMock.encrypt.mockReset().mockResolvedValue(Uint8Array.from([9, 9, 9]));
  cryptMock.generateSRPTriplet.mockReset().mockResolvedValue({
    toUint8Array: () => Uint8Array.from([1, 2, 3]),
  });
  cryptMock.randomBytes.mockReset().mockReturnValue(Uint8Array.from([1, 2, 3, 4]));
  cryptMock.SRP_CheckM2.mockReset().mockReturnValue(true);

  srpMock.initialize.mockReset().mockResolvedValue(srpClientMock);
  srpMock.generateSalt.mockReset().mockReturnValue(Uint8Array.from([7, 8, 9]));
  srpClientMock.setB.mockReset().mockResolvedValue(undefined);

  vi.stubGlobal("fetch", vi.fn());
});

describe("LoginDialog", () => {
  it("renders login title and offline fallback when metadata missing", async () => {
    renderLoginDialog();

    expect(screen.getByText("Log in to your account")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /use in offline mode/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("...")).toBeInTheDocument();

    await waitFor(() => {
      expect(apiMock.setUrl).toHaveBeenCalledWith(
        "https://atrxis.com/acLife/api/",
      );
    });
  });

  it("opens server switcher, tests connectivity, and saves server", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: defaultServerMeta,
        }),
      });

    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("serverURL", "https://old.example/api/");

    renderLoginDialog();

    await user.click(screen.getByText("..."));
    expect(screen.getByText("Change server")).toBeInTheDocument();

    const input = await screen.findByLabelText("Server URL");
    await user.clear(input);
    await user.type(input, "next.example/api");

    const testConnectionButton = input.parentElement?.querySelector(
      "button",
    ) as HTMLButtonElement | null;

    expect(testConnectionButton).toBeTruthy();
    expect(testConnectionButton!).toBeEnabled();

    await user.click(testConnectionButton!);
    expect(await screen.findByText(/connection failed/i)).toBeInTheDocument();

    await user.click(testConnectionButton!);
    expect(await screen.findByText(/invalid metadata/i)).toBeInTheDocument();

    await user.click(testConnectionButton!);
    expect(
      await screen.findByText(/connection successful/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(localStorage.setItem).toHaveBeenCalledWith(
      "serverURL",
      "next.example/api",
    );
    expect(apiMock.setUrl).toHaveBeenCalledWith("next.example/api");
    await waitFor(() => {
      expect(screen.queryByText("Change server")).not.toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://next.example/api/metadata",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://next.example/api/metadata",
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://next.example/api/metadata",
    );
  });

  it("renders login form when server metadata exists", () => {
    apiMock.serverMeta = defaultServerMeta;

    renderLoginDialog();

    expect(screen.getByText("api.example.com")).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeInTheDocument();
  });

  it("toggles create account form", async () => {
    apiMock.serverMeta = defaultServerMeta;
    const user = userEvent.setup();

    renderLoginDialog();
    await openRegistrationForm(user);

    expect(
      screen.getByRole("button", { name: /have an account\? log in/i }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /have an account\? log in/i }),
    );

    await waitFor(() => {
      expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
    });
  });

  it("shows validation error when registration passwords do not match", async () => {
    apiMock.serverMeta = defaultServerMeta;
    const user = userEvent.setup();

    renderLoginDialog();
    await openRegistrationForm(user);

    await user.type(screen.getByLabelText(/email address/i), "user@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "StrongPassword123!");
    await user.type(
      screen.getByLabelText(/confirm password/i),
      "DifferentPassword123!",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it("submits registration and shows success message", async () => {
    apiMock.serverMeta = defaultServerMeta;
    const powToken = `${btoa(
      JSON.stringify({ seed: "abc", email: "new@example.com", expires: 9999999999 }),
    )}.sig`;
    apiMock.post.mockImplementation(async (endpoint: string) => {
      if (endpoint === "auth/register/challenge") {
        return { success: true, data: { token: powToken, difficulty: 0 } };
      }
      return { success: true };
    });
    const user = userEvent.setup();

    renderLoginDialog();
    await openRegistrationForm(user);

    await user.type(screen.getByLabelText(/email address/i), "new@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "StrongPassword123!");
    await user.type(
      screen.getByLabelText(/confirm password/i),
      "StrongPassword123!",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      await screen.findByText(/account created\. you may now log in\./i),
    ).toBeInTheDocument();
    expect(cryptMock.generateSRPTriplet).toHaveBeenCalledWith(
      "new@example.com",
      "StrongPassword123!",
    );
    expect(apiMock.post).toHaveBeenCalledWith(
      "auth/register/challenge",
      { email: "new@example.com" },
    );
    expect(apiMock.post).toHaveBeenCalledWith(
      "auth/register",
      expect.objectContaining({
        challenge: expect.any(String),
        triplet: expect.any(String),
        salt: expect.any(String),
        powToken,
        powNonce: expect.any(String),
      }),
    );
  });

  it("disables account creation when server blocks registrations", () => {
    apiMock.serverMeta = {
      ...defaultServerMeta,
      registration: {
        ...defaultServerMeta.registration,
        enabled: false,
      },
    };

    renderLoginDialog();

    expect(
      screen.getByRole("button", { name: /create account/i }),
    ).toBeDisabled();
  });

  it("submits login flow and calls checkLogin", async () => {
    apiMock.serverMeta = defaultServerMeta;
    apiMock.post
      .mockResolvedValueOnce({
        success: true,
        data: btoa(String.fromCharCode(1, 2, 3)),
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          B: btoa(String.fromCharCode(4, 5, 6)),
          session_id: "session-1",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          M2: btoa(String.fromCharCode(7, 8, 9)),
        },
      });

    const user = userEvent.setup();
    renderLoginDialog();

    await user.type(screen.getByLabelText(/email address/i), "user@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "StrongPassword123!");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => {
      expect(userMock.checkLogin).toHaveBeenCalledWith("StrongPassword123!");
    });

    expect(apiMock.post).toHaveBeenNthCalledWith(1, "auth/login/start", {
      email: "user@example.com",
    });
    expect(apiMock.post).toHaveBeenNthCalledWith(2, "auth/login/start", {
      email: "user@example.com",
      A: btoa(String.fromCharCode(1, 2, 3)),
    });
    expect(apiMock.post).toHaveBeenNthCalledWith(3, "auth/login/verify", {
      email: "user@example.com",
      M1: btoa(String.fromCharCode(4, 5, 6)),
      session_id: "session-1",
    });
    expect(srpMock.initialize).toHaveBeenCalled();
    expect(srpClientMock.setB).toHaveBeenCalled();
  });
});
