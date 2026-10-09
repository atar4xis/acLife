import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const updater = vi.hoisted(() => ({
  status: "idle",
  latest: null as null | { version: string; url: string },
  canInstall: false,
  changelog: [] as unknown[],
  lastChecked: null as number | null,
  check: vi.fn(),
  install: vi.fn(),
}));

vi.mock("../../src/context/UpdaterContext.tsx", () => ({
  useUpdater: () => updater,
}));

import ApplicationPage from "../../src/components/settings/pages/ApplicationPage.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";

const renderPage = () =>
  render(
    <SettingsStoreProvider>
      <ApplicationPage sectionRefs={{ current: new Map() }} />
    </SettingsStoreProvider>,
  );

describe("ApplicationPage", () => {
  it("shows the version, repository and website", () => {
    renderPage();

    expect(screen.getAllByText(__APP_VERSION__).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "GitHub repository" }),
    ).toBeTruthy();
    expect(
      screen.getByText(window.location.origin + import.meta.env.BASE_URL),
    ).toBeTruthy();
  });

  it("checks for updates on click", () => {
    renderPage();

    screen.getByRole("button", { name: "Check now" }).click();

    expect(updater.check).toHaveBeenCalled();
  });

  it("offers the download link when an update cannot be installed", () => {
    updater.status = "available";
    updater.latest = { version: "9.9.9", url: "https://example.com/r" };
    renderPage();

    expect(screen.getByText("Update available (9.9.9)")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Download" }).getAttribute("href"),
    ).toBe("https://example.com/r");
  });

  it("offers install when the update can be installed", () => {
    updater.status = "available";
    updater.canInstall = true;
    renderPage();

    screen.getByRole("button", { name: "Install" }).click();

    expect(updater.install).toHaveBeenCalled();
  });
});
