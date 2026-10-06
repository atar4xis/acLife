import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { ServerMetadata } from "../../src/types/ServerMetadata.ts";

const apiMock = vi.hoisted(() => ({
  url: "https://mock.example/api/",
  setUrl: vi.fn(),
  post: vi.fn(),
  serverMeta: null as ServerMetadata | null,
  pendingVerificationEmail: null as string | null,
  setPendingVerificationEmail: vi.fn(),
}));

const userMock = vi.hoisted(() => ({
  setUser: vi.fn(),
  setMasterKey: vi.fn(),
  checkLogin: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  missing: false,
  get: vi.fn(),
  set: vi.fn(),
}));

const cryptMock = vi.hoisted(() => ({
  generateMasterKeyEnvelope: vi.fn(),
  generateSRPTriplet: vi.fn(),
  randomBytes: vi.fn(),
  deriveMasterKey: vi.fn(),
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
    url: apiMock.url,
    setUrl: apiMock.setUrl,
    get: vi.fn(),
    getRaw: vi.fn(),
    post: apiMock.post,
    query: vi.fn(),
    serverMeta: apiMock.serverMeta,
    setServerMeta: vi.fn(),
    pendingLogout: false,
    setPendingLogout: vi.fn(),
    pendingVerificationEmail: apiMock.pendingVerificationEmail,
    setPendingVerificationEmail: apiMock.setPendingVerificationEmail,
  }),
}));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => userMock,
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => (storageMock.missing ? null : storageMock),
}));

vi.mock("../../src/lib/crypt.ts", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/crypt.ts")>(
    "../../src/lib/crypt.ts",
  );

  return {
    ...actual,
    generateMasterKeyEnvelope: cryptMock.generateMasterKeyEnvelope,
    generateSRPTriplet: cryptMock.generateSRPTriplet,
    randomBytes: cryptMock.randomBytes,
    deriveMasterKey: cryptMock.deriveMasterKey,
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
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";

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

const renderLoginDialog = () =>
  render(
    <SettingsStoreProvider>
      <LoginDialog />
    </SettingsStoreProvider>,
  );

const openRegistrationForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /create account/i }));

  expect(await screen.findByLabelText(/confirm password/i)).toBeInTheDocument();
};

beforeEach(() => {
  apiMock.url = "https://mock.example/api/";
  apiMock.serverMeta = null;
  apiMock.setUrl.mockReset();
  apiMock.post.mockReset();
  apiMock.pendingVerificationEmail = null;
  apiMock.setPendingVerificationEmail.mockReset();

  userMock.setUser.mockReset();
  userMock.setMasterKey.mockReset();
  userMock.checkLogin.mockReset().mockResolvedValue(undefined);

  storageMock.missing = false;
  storageMock.get.mockReset().mockReturnValue("");
  storageMock.set.mockReset();

  cryptMock.generateMasterKeyEnvelope.mockReset().mockResolvedValue({
    masterKey: {} as CryptoKey,
    bucketKey: {} as CryptoKey,
    envelope: {
      type: "master",
      version: 1,
      salt: "c2FsdA==",
      data: "ZGF0YQ==",
      kdfParams: JSON.stringify({
        algo: "argon2id",
        time: 3,
        mem: 65536,
        parallelism: 1,
        hashLen: 32,
      }),
    },
  });
  cryptMock.generateSRPTriplet.mockReset().mockResolvedValue({
    toUint8Array: () => Uint8Array.from([1, 2, 3]),
  });
  cryptMock.deriveMasterKey.mockReset();
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

  it("shows the create account title while registering", async () => {
    apiMock.serverMeta = defaultServerMeta;
    const user = userEvent.setup();

    renderLoginDialog();
    expect(screen.getByText("Log in to your account")).toBeInTheDocument();

    await openRegistrationForm(user);
    expect(screen.getByText("Create an account")).toBeInTheDocument();
    expect(screen.queryByText("Log in to your account")).toBeNull();

    await user.click(screen.getByRole("button", { name: /have an account/i }));
    expect(screen.getByText("Log in to your account")).toBeInTheDocument();
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
        triplet: expect.any(String),
        envelopes: [
          expect.objectContaining({ type: "master", version: 1 }),
        ],
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

describe("LoginDialog email first registration", () => {
  const verifiedMeta: ServerMetadata = {
    ...defaultServerMeta,
    registration: {
      ...defaultServerMeta.registration,
      email: { verificationRequired: true, domainBlacklist: [] },
    },
  };
  const powToken = `${btoa(
    JSON.stringify({ seed: "abc", email: "new@example.com", expires: 9999999999 }),
  )}.sig`;
  const token = "a".repeat(64);
  const linkHash = (server = "https://mock.example/api") =>
    `#token=${btoa(
      JSON.stringify({ token, email: "new@example.com", server }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}`;

  const mockStart = (registered: boolean) =>
    apiMock.post.mockImplementation(async (endpoint: string) => {
      if (endpoint === "auth/register/challenge") {
        return { success: true, data: { token: powToken, difficulty: 0 } };
      }
      return { success: true, data: { registered } };
    });

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  afterEach(() => {
    window.location.hash = "";
  });

  it("asks for the email alone and mails a link", async () => {
    apiMock.serverMeta = verifiedMeta;
    mockStart(false);
    const user = userEvent.setup();

    renderLoginDialog();
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/email address/i), "new@example.com");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText(/verification required/i)).toBeInTheDocument();
    expect(screen.getByText("new@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resend email (60s)" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /back to login/i }));
    expect(screen.queryByText(/verification required/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(apiMock.setPendingVerificationEmail).toHaveBeenCalledWith(null);
    expect(apiMock.post).toHaveBeenCalledWith("auth/register/start", {
      email: "new@example.com",
      powToken,
      powNonce: expect.any(String),
    });
    expect(cryptMock.generateSRPTriplet).not.toHaveBeenCalled();
    expect(apiMock.post).not.toHaveBeenCalledWith(
      "auth/register",
      expect.anything(),
    );
  });

  it("forwards the honeypot field when a bot fills it", async () => {
    apiMock.serverMeta = verifiedMeta;
    mockStart(false);
    const user = userEvent.setup();

    renderLoginDialog();
    await user.click(screen.getByRole("button", { name: /create account/i }));
    await user.type(screen.getByLabelText(/email address/i), "new@example.com");
    await user.type(screen.getByLabelText(/^confirm email/i), "bot@example.com");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        "auth/register/start",
        expect.objectContaining({ confirmEmail: "bot@example.com" }),
      ),
    );
  });

  it("takes an existing email to the login form with it filled in", async () => {
    apiMock.serverMeta = verifiedMeta;
    mockStart(true);
    const user = userEvent.setup();

    renderLoginDialog();
    await user.click(screen.getByRole("button", { name: /create account/i }));
    await user.type(screen.getByLabelText(/email address/i), "new@example.com");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveValue("new@example.com");
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/verification required/i)).not.toBeInTheDocument();
  });

  it("lets the link choose the password and completes the registration", async () => {
    apiMock.serverMeta = verifiedMeta;
    apiMock.post.mockResolvedValue({ success: true });
    window.location.hash = linkHash();
    const user = userEvent.setup();

    renderLoginDialog();

    const email = await screen.findByLabelText(/email address/i);
    expect(email).toHaveValue("new@example.com");
    expect(email).toHaveAttribute("readonly");
    expect(screen.getByText("Create an account")).toBeInTheDocument();
    expect(window.location.hash).toBe("");

    await user.type(screen.getByLabelText(/^password$/i), "StrongPassword123!");
    await user.type(
      screen.getByLabelText(/confirm password/i),
      "StrongPassword123!",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      await screen.findByText(/account created\. you may now log in\./i),
    ).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith("auth/register/complete", {
      token,
      triplet: expect.any(String),
      envelopes: [expect.objectContaining({ type: "master", version: 1 })],
    });
    expect(apiMock.post).not.toHaveBeenCalledWith(
      "auth/register/challenge",
      expect.anything(),
    );
    expect(screen.getByLabelText(/email address/i)).toHaveValue("new@example.com");
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
  });

  it("keeps the form when the link is refused", async () => {
    apiMock.serverMeta = verifiedMeta;
    apiMock.post.mockResolvedValue({
      success: false,
      message: "Verification link invalid or expired.",
    });
    window.location.hash = linkHash();
    const user = userEvent.setup();

    renderLoginDialog();

    await user.type(await screen.findByLabelText(/^password$/i), "StrongPassword123!");
    await user.type(
      screen.getByLabelText(/confirm password/i),
      "StrongPassword123!",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      await screen.findByText(/verification link invalid or expired/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it("leaves the link when the user picks login", async () => {
    apiMock.serverMeta = verifiedMeta;
    window.location.hash = linkHash();
    const user = userEvent.setup();

    renderLoginDialog();
    await user.click(await screen.findByRole("button", { name: /have an account/i }));

    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).not.toHaveAttribute("readonly");
  });

  it("ignores a link made for another server", async () => {
    apiMock.serverMeta = verifiedMeta;
    window.location.hash = linkHash("https://other.example/api");

    renderLoginDialog();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).not.toHaveAttribute("readonly");
    expect(window.location.hash).toBe("");
  });

  it("picks up a link opened in the same tab", async () => {
    apiMock.serverMeta = verifiedMeta;

    renderLoginDialog();
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();

    window.location.hash = linkHash();

    expect(await screen.findByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveValue("new@example.com");
    expect(window.location.hash).toBe("");
  });

  it("waits for the server url before judging the link", async () => {
    apiMock.serverMeta = verifiedMeta;
    apiMock.url = "";
    window.location.hash = linkHash();

    const view = renderLoginDialog();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();

    apiMock.url = "https://mock.example/api/";
    view.rerender(
      <SettingsStoreProvider>
        <LoginDialog />
      </SettingsStoreProvider>,
    );

    expect(await screen.findByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    ["not base64", "#token=%%%"],
    ["not json", `#token=${btoa("nope")}`],
    ["the wrong types", `#token=${btoa(JSON.stringify({ token: 1, email: 2, server: 3 }))}`],
  ])("shows an error and clears a malformed link: %s", async (_name, hash) => {
    apiMock.serverMeta = verifiedMeta;
    window.location.hash = hash;

    renderLoginDialog();

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(window.location.hash).toBe("");
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
  });

  it("drops the link and clears the form when the server is switched", async () => {
    apiMock.serverMeta = verifiedMeta;
    window.location.hash = linkHash();
    apiMock.setUrl.mockImplementation((next: string) => {
      if (next === "https://next.example/api/") apiMock.url = next;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: verifiedMeta }),
      }),
    );
    const user = userEvent.setup();

    renderLoginDialog();
    await user.type(
      await screen.findByLabelText(/^password$/i),
      "StrongPassword123!",
    );

    await user.click(screen.getByText("api.example.com"));
    const input = await screen.findByLabelText("Server URL");
    await user.clear(input);
    await user.type(input, "https://next.example/api/");
    await user.click(input.parentElement!.querySelector("button")!);
    await screen.findByText(/connection successful/i);
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/email address/i)).toHaveValue("");
    expect(screen.getByLabelText(/email address/i)).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText(/^password$/i)).toHaveValue("");
  });

  it("keeps the query string when it clears a link", async () => {
    apiMock.serverMeta = verifiedMeta;
    window.history.replaceState({}, "", `/?keep=1${linkHash()}`);

    renderLoginDialog();

    expect(await screen.findByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("");
    window.history.replaceState({}, "", "/");
  });

  it("replaces the verification screen when a link arrives", async () => {
    apiMock.serverMeta = verifiedMeta;
    apiMock.pendingVerificationEmail = "pending@example.com";

    renderLoginDialog();
    expect(await screen.findByText(/verification required/i)).toBeInTheDocument();

    window.location.hash = linkHash();

    expect(await screen.findByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.queryByText(/verification required/i)).not.toBeInTheDocument();
    expect(apiMock.setPendingVerificationEmail).toHaveBeenCalledWith(null);
  });

  it("does not revive a dropped link when the server switches back", async () => {
    apiMock.serverMeta = verifiedMeta;
    window.location.hash = linkHash();
    const ui = () => (
      <SettingsStoreProvider>
        <LoginDialog />
      </SettingsStoreProvider>
    );

    const view = renderLoginDialog();
    expect(await screen.findByLabelText(/confirm password/i)).toBeInTheDocument();

    apiMock.url = "https://other.example/api/";
    view.rerender(ui());
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();

    apiMock.url = "https://mock.example/api/";
    view.rerender(ui());
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).not.toHaveAttribute("readonly");
  });

  it("leaves hashes without a token alone", () => {
    apiMock.serverMeta = verifiedMeta;
    window.location.hash = "#other=1";

    renderLoginDialog();

    expect(window.location.hash).toBe("#other=1");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps the usual form when the server does not verify emails", async () => {
    apiMock.serverMeta = defaultServerMeta;
    const user = userEvent.setup();

    renderLoginDialog();
    await openRegistrationForm(user);

    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });
});

describe("LoginDialog server switcher", () => {
  const openSwitcher = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByText("..."));
    return screen.findByLabelText("Server URL");
  };

  it("starts from the saved server and can be cancelled", async () => {
    const user = userEvent.setup();
    localStorage.setItem("serverURL", "https://old.example/api/");

    renderLoginDialog();
    const input = await openSwitcher(user);

    expect(input).toHaveValue("https://old.example/api/");
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText("Change server")).not.toBeInTheDocument();
    expect(screen.getByText("Log in to your account")).toBeInTheDocument();
  });

  it("locks the form while testing and forgets a result once edited", async () => {
    const user = userEvent.setup();
    let finish!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => (finish = resolve))),
    );

    renderLoginDialog();
    const input = await openSwitcher(user);
    const test = input.parentElement!.querySelector("button")!;

    await user.clear(input);
    expect(test).toBeDisabled();

    await user.type(input, "next.example/api");
    expect(test).toBeEnabled();
    await user.click(test);
    expect(input).toBeDisabled();
    expect(test).toBeDisabled();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();

    finish({
      ok: true,
      json: async () => ({ success: true, data: defaultServerMeta }),
    });
    expect(await screen.findByText(/connection successful/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled();

    await user.type(input, "x");
    expect(screen.queryByText(/connection successful/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });
});

describe("LoginDialog verification screens", () => {
  it("shows the pending verification email with resend ready and goes back", async () => {
    apiMock.serverMeta = defaultServerMeta;
    apiMock.pendingVerificationEmail = "pending@example.com";
    const user = userEvent.setup();

    renderLoginDialog();

    expect(await screen.findByText(/verification required/i)).toBeInTheDocument();
    expect(screen.getByText("pending@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend email" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /back to login/i }));

    expect(apiMock.setPendingVerificationEmail).toHaveBeenCalledWith(null);
    expect(screen.queryByText(/verification required/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  describe("email confirmation link", () => {
    afterEach(() => window.history.replaceState({}, "", "/"));

    it("asks to confirm, keeps other query params, and posts the token", async () => {
      apiMock.serverMeta = defaultServerMeta;
      apiMock.post.mockResolvedValue({ success: true });
      window.history.replaceState({}, "", "/?verify_token=abc&keep=1");
      const user = userEvent.setup();

      renderLoginDialog();

      expect(screen.getByText(/click the button below to verify/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
      expect(window.location.search).toBe("?keep=1");

      await user.click(screen.getByRole("button", { name: "Verify email" }));

      expect(apiMock.post).toHaveBeenCalledWith("auth/verify-email", { token: "abc" });
      expect(await screen.findByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.queryByText(/click the button below to verify/i)).not.toBeInTheDocument();
    });

    it("drops the prompt on cancel and leaves the url bare", async () => {
      apiMock.serverMeta = defaultServerMeta;
      window.history.replaceState({}, "", "/?verify_token=abc");
      const user = userEvent.setup();

      renderLoginDialog();
      expect(window.location.search).toBe("");

      await user.click(screen.getByRole("button", { name: /cancel/i }));

      expect(apiMock.post).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    });

    it("shows no prompt without a token", () => {
      apiMock.serverMeta = defaultServerMeta;
      window.history.replaceState({}, "", "/?other=1");

      renderLoginDialog();

      expect(screen.queryByText(/click the button below to verify/i)).not.toBeInTheDocument();
      expect(window.location.search).toBe("?other=1");
    });
  });
});

describe("LoginDialog offline mode", () => {
  const importableKey = () => btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

  it("creates and stores a new offline key from the fallback button", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ]);
    cryptMock.deriveMasterKey.mockResolvedValue({ masterKey: key });
    renderLoginDialog();

    const defaultAllowed = fireEvent.click(
      screen.getByRole("button", { name: /use in offline mode/i }),
    );

    await waitFor(() => expect(userMock.setMasterKey).toHaveBeenCalledWith(key));
    expect(defaultAllowed).toBe(false);
    expect(storageMock.get).toHaveBeenCalledWith("offlineMasterKey");
    expect(storageMock.set).toHaveBeenCalledWith(
      "offlineMasterKey",
      expect.stringMatching(/^[A-Za-z0-9+/]{43}=$/),
    );
    expect(userMock.setUser).toHaveBeenCalledWith({ type: "offline" });
  });

  it("reuses the stored offline key from the login form", async () => {
    apiMock.serverMeta = defaultServerMeta;
    storageMock.get.mockReturnValue(importableKey());
    const user = userEvent.setup();
    renderLoginDialog();

    await user.click(screen.getByRole("button", { name: /offline mode/i }));

    await waitFor(() => expect(userMock.setUser).toHaveBeenCalledWith({ type: "offline" }));
    expect(userMock.setMasterKey).toHaveBeenCalledWith(expect.objectContaining({ type: "secret" }));
    expect(storageMock.get).toHaveBeenCalledWith("offlineMasterKey");
    expect(cryptMock.deriveMasterKey).not.toHaveBeenCalled();
    expect(storageMock.set).not.toHaveBeenCalled();
  });

  it("does nothing without storage", () => {
    storageMock.missing = true;
    renderLoginDialog();

    const defaultAllowed = fireEvent.click(
      screen.getByRole("button", { name: /use in offline mode/i }),
    );

    expect(defaultAllowed).toBe(true);
    expect(userMock.setUser).not.toHaveBeenCalled();
  });
});

describe("LoginDialog language", () => {
  it("offers a language picker", () => {
    renderLoginDialog();

    expect(screen.getByRole("combobox", { name: /language/i })).toBeInTheDocument();
  });
});
