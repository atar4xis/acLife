import { toast } from "sonner";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import {
  SettingsStoreProvider,
  useSettingsStore,
} from "@/context/SettingsStoreContext";
import { SETTINGS_STORAGE_KEY } from "@/lib/settingsStore";
import { arrayBufferToBase64 } from "@/lib/utils";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const get = vi.fn();
const post = vi.fn();
const api = {
  get,
  post,
  serverMeta: { registration: { subscriptionRequired: false } },
};

vi.mock("@/context/ApiContext", () => ({ useApi: () => api }));
const session = {
  user: { type: "online", subscription_status: null as string | null },
  masterKey: {} as CryptoKey,
};
vi.mock("@/context/UserContext", () => ({ useUser: () => session }));
vi.mock("@/lib/crypt", () => ({
  encrypt: async (data: Uint8Array) => data.buffer,
  decrypt: async (data: Uint8Array) => data,
}));

const blob = (payload: object) =>
  arrayBufferToBase64(new TextEncoder().encode(JSON.stringify(payload)).buffer);

const setup = () =>
  renderHook(
    () => {
      useSettingsSync();
      return useSettingsStore();
    },
    { wrapper: SettingsStoreProvider },
  );

describe("useSettingsSync", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    vi.mocked(toast.error).mockClear();
    localStorage.clear();
    api.serverMeta.registration.subscriptionRequired = false;
    session.user.subscription_status = null;
  });

  it("applies newer remote settings without uploading", async () => {
    get.mockResolvedValue({
      success: true,
      data: {
        version: 3,
        data: blob({ defaultView: { value: "day", updatedAt: 10 } }),
      },
    });

    const { result } = setup();

    await waitFor(() =>
      expect(result.current.getSnapshot().defaultView).toBe("day"),
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("overwrites an unreadable remote blob with local settings", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    get.mockResolvedValue({
      success: true,
      data: { version: 4, data: blob([1, 2]) },
    });
    post.mockResolvedValue({ success: true });

    const { result } = setup();
    result.current.setSetting("defaultView", "day");

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1), {
      timeout: 4000,
    });
    expect(post.mock.calls[0][1]).toMatchObject({ baseVersion: 4 });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not contact the server while sync is off", async () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        values: {},
        updatedAt: {},
        syncOverrides: {},
        syncEnabled: false,
      }),
    );

    setup();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(get).not.toHaveBeenCalled();
  });

  it("uploads local changes and retries once on a version conflict", async () => {
    get.mockResolvedValue({
      success: true,
      data: { version: 1, data: blob({}) },
    });
    post
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true });

    const { result } = setup();
    result.current.setSetting("defaultView", "day");

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2), {
      timeout: 4000,
    });
    expect(post.mock.calls[1][1]).toMatchObject({ baseVersion: 1 });
  });

  it("reuses the settings sent back with a conflict instead of fetching again", async () => {
    get.mockResolvedValue({
      success: true,
      data: { version: 1, data: blob({}) },
    });
    post
      .mockResolvedValueOnce({
        success: false,
        data: { version: 2, data: blob({}) },
      })
      .mockResolvedValueOnce({ success: true });

    const { result } = setup();
    result.current.setSetting("defaultView", "day");

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2), {
      timeout: 4000,
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[1][1]).toMatchObject({ baseVersion: 2 });
  });

  it("does not sync after a change to a setting that is not synced", async () => {
    get.mockResolvedValue({
      success: true,
      data: { version: 1, data: blob({}) },
    });

    const { result } = setup();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    result.current.setSetting("theme", "dark");
    await new Promise((resolve) => setTimeout(resolve, 2300));

    expect(get).toHaveBeenCalledTimes(1);
  });

  it("applies nothing once unmounted", async () => {
    let resolveGet: (value: unknown) => void = () => {};
    get.mockReturnValue(new Promise((resolve) => (resolveGet = resolve)));

    const { result, unmount } = setup();
    const store = result.current;
    await waitFor(() => expect(get).toHaveBeenCalled());

    unmount();
    resolveGet({
      success: true,
      data: {
        version: 3,
        data: blob({ defaultView: { value: "day", updatedAt: 10 } }),
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(store.getSnapshot().defaultView).not.toBe("day");
  });

  it("reports an error when an upload fails without a conflict", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    get.mockResolvedValue({
      success: true,
      data: { version: 1, data: blob({}) },
    });
    post.mockResolvedValue({ success: false });

    const { result } = setup();
    result.current.setSetting("defaultView", "day");

    await waitFor(() => expect(logged).toHaveBeenCalled());
    expect(post).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("reports an error after three version conflicts", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    get.mockResolvedValue({
      success: true,
      data: { version: 1, data: blob({}) },
    });
    post.mockResolvedValue({
      success: false,
      data: { version: 2, data: blob({}) },
    });

    const { result } = setup();
    result.current.setSetting("defaultView", "day");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Failed to sync settings."),
    );
    expect(post).toHaveBeenCalledTimes(3);
    expect(logged).toHaveBeenCalled();
  });

  it("does not sync before server metadata has loaded", async () => {
    const meta = api.serverMeta;
    api.serverMeta = null as never;
    try {
      setup();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(get).not.toHaveBeenCalled();
    } finally {
      api.serverMeta = meta;
    }
  });

  describe("when the server requires a subscription", () => {
    beforeEach(() => {
      api.serverMeta.registration.subscriptionRequired = true;
      get.mockResolvedValue({
        success: true,
        data: { version: 1, data: blob({}) },
      });
    });

    it("does not sync without one", async () => {
      setup();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(get).not.toHaveBeenCalled();
    });

    it("syncs with an active one", async () => {
      session.user.subscription_status = "active";
      setup();

      await waitFor(() => expect(get).toHaveBeenCalled());
    });
  });
});
