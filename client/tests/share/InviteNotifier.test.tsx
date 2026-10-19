import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { seedSettings } from "../settingsStorage";

const world = vi.hoisted(() => ({
  invites: [] as unknown[],
  notified: [] as string[],
  nicknames: {} as Record<string, string>,
  mobile: false,
}));

vi.mock("../../src/context/ShareContext.tsx", () => ({
  useShares: () => ({
    invites: world.invites,
    nameOf: (uuid: string, email: string) => world.nicknames[uuid] ?? email,
  }),
}));
vi.mock("../../src/context/StorageContext.tsx", () => {
  const storage = {
    ready: true,
    get: () => world.notified,
    set: (_: string, value: string[]) => {
      world.notified = value;
    },
  };
  return { useStorage: () => storage };
});
vi.mock("../../src/hooks/use-mobile.ts", () => ({
  useIsMobile: () => world.mobile,
}));

import InviteNotifier from "../../src/components/sharing/InviteNotifier.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";

const invite = (id: string) => ({
  id,
  owner: "ann",
  ownerEmail: "ann@example.com",
  kind: "journal",
  scope: "collection",
});

const renderNotifier = (onView = vi.fn()) => {
  const view = render(
    <SettingsStoreProvider>
      <InviteNotifier onView={onView} />
    </SettingsStoreProvider>,
  );
  return { ...view, onView };
};

beforeEach(() => {
  vi.clearAllMocks();
  world.invites = [];
  world.notified = [];
  world.mobile = false;
  world.nicknames = {};
  seedSettings({});
});

describe("InviteNotifier", () => {
  it("pops up in the top left for a new invitation", () => {
    world.invites = [invite("i1")];
    renderNotifier();

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(
      "New invitation",
      expect.objectContaining({
        description: "ann@example.com shared a journal or folder with you.",
        position: "top-left",
      }),
    );
  });

  it("names the sender by their nickname", () => {
    world.nicknames = { ann: "Annie" };
    world.invites = [invite("i1")];
    renderNotifier();

    expect(toast.info).toHaveBeenCalledWith(
      "New invitation",
      expect.objectContaining({
        description: "Annie shared a journal or folder with you.",
      }),
    );
  });

  it("spans the top on mobile", () => {
    world.mobile = true;
    world.invites = [invite("i1")];
    renderNotifier();

    expect(toast.info).toHaveBeenCalledWith(
      "New invitation",
      expect.objectContaining({ position: "top-center" }),
    );
  });

  it("opens the sharing settings from the popup", () => {
    world.invites = [invite("i1")];
    const { onView } = renderNotifier();

    const [, options] = vi.mocked(toast.info).mock.calls[0];
    (options!.action as unknown as { onClick: () => void }).onClick();
    expect(onView).toHaveBeenCalledWith("sharing");
  });

  it("tells about each invitation only once", () => {
    world.invites = [invite("i1")];
    const { rerender, onView } = renderNotifier();
    world.invites = [invite("i1"), invite("i2")];
    rerender(
      <SettingsStoreProvider>
        <InviteNotifier onView={onView} />
      </SettingsStoreProvider>,
    );

    expect(toast.info).toHaveBeenCalledTimes(2);
    renderNotifier();
    expect(toast.info).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when the setting is off, and does not replay later", () => {
    seedSettings({ inviteNotifications: false });
    world.invites = [invite("i1")];
    renderNotifier();

    expect(toast.info).not.toHaveBeenCalled();
    expect(world.notified).toEqual(["i1"]);
  });

  it("does nothing without invitations", () => {
    renderNotifier();
    act(() => {});
    expect(toast.info).not.toHaveBeenCalled();
  });
});
