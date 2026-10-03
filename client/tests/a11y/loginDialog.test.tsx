import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, it, vi } from "vitest";
import type { ServerMetadata } from "../../src/types/ServerMetadata.ts";
import { expectNoViolations } from "./axe.ts";

const apiMock = vi.hoisted(() => ({
  serverMeta: null as ServerMetadata | null,
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({
    url: "https://mock.example/api/",
    setUrl: vi.fn(),
    get: vi.fn(),
    getRaw: vi.fn(),
    post: vi.fn(),
    query: vi.fn(),
    serverMeta: apiMock.serverMeta,
    setServerMeta: vi.fn(),
    pendingLogout: false,
    setPendingLogout: vi.fn(),
  }),
}));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({
    setUser: vi.fn(),
    setMasterKey: vi.fn(),
    checkLogin: vi.fn(),
  }),
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ get: vi.fn().mockReturnValue(""), set: vi.fn() }),
}));

import LoginDialog from "../../src/components/login/LoginDialog.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";

const serverMeta: ServerMetadata = {
  url: "https://api.example.com/acLife/api",
  policies: {},
  registration: {
    enabled: true,
    subscriptionRequired: false,
    email: { verificationRequired: false, domainBlacklist: [] },
  },
  vapidPublicKey: "test-vapid-key",
};

describe("LoginDialog a11y", () => {
  beforeEach(() => {
    apiMock.serverMeta = serverMeta;
  });

  it("login form has no axe violations", async () => {
    render(
      <SettingsStoreProvider>
        <LoginDialog />
      </SettingsStoreProvider>,
    );
    await screen.findByLabelText(/email/i);
    await expectNoViolations(document.body);
  });

  it("registration form has no axe violations", async () => {
    const user = userEvent.setup();
    render(
      <SettingsStoreProvider>
        <LoginDialog />
      </SettingsStoreProvider>,
    );
    await user.click(screen.getByRole("button", { name: /create account/i }));
    await screen.findByLabelText(/confirm password/i);
    await expectNoViolations(document.body);
  });

  it("server switcher has no axe violations", async () => {
    const user = userEvent.setup();
    render(
      <SettingsStoreProvider>
        <LoginDialog />
      </SettingsStoreProvider>,
    );
    await user.click(screen.getByRole("button", { name: "api.example.com" }));
    await screen.findByRole("button", { name: "Test connectivity" });
    await expectNoViolations(document.body);
  });
});
