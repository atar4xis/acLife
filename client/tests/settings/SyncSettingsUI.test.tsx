import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const userMock = vi.hoisted(() => ({ user: null as { type: string } | null }));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => userMock,
}));

vi.mock("../../src/hooks/usePushService.ts", () => ({
  usePushService: () => ({
    supported: false,
    enabled: false,
    enable: vi.fn(),
    disable: vi.fn(),
  }),
}));

import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import SettingsLabel from "../../src/components/settings/SettingsLabel.tsx";
import SyncToggle from "../../src/components/settings/SyncToggle.tsx";
import SyncPage from "../../src/components/settings/pages/SyncPage.tsx";
import type { SectionRefs } from "../../src/components/settings/SettingsSection.tsx";
import { readSettingsMeta } from "../settingsStorage.ts";

const storedOverrides = () => readSettingsMeta().syncOverrides;

const renderInProvider = (ui: React.ReactNode) =>
  render(<SettingsStoreProvider>{ui}</SettingsStoreProvider>);

beforeEach(() => {
  userMock.user = { type: "online" };
});

describe("SyncToggle", () => {
  it("renders nothing without an online account", () => {
    userMock.user = { type: "offline" };
    const { container, rerender } = renderInProvider(
      <SyncToggle settingKey="defaultView" />,
    );
    expect(container).toBeEmptyDOMElement();

    userMock.user = null;
    rerender(
      <SettingsStoreProvider>
        <SyncToggle settingKey="defaultView" />
      </SettingsStoreProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a setting that syncs by default as synced", () => {
    renderInProvider(<SyncToggle settingKey="defaultView" />);

    expect(
      screen.getByRole("button", { name: "Sync this setting" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a setting that does not sync by default as device-only", () => {
    renderInProvider(<SyncToggle settingKey="snapMinutes" />);

    expect(
      screen.getByRole("button", { name: "Sync this setting" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("stores an opt-out and removes it again when toggled back", async () => {
    const user = userEvent.setup();
    renderInProvider(<SyncToggle settingKey="defaultView" />);
    const button = screen.getByRole("button", { name: "Sync this setting" });

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(storedOverrides()).toEqual({ defaultView: false });

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(storedOverrides()).toEqual({});
  });

  it("stores an opt-in for a setting that does not sync by default", async () => {
    const user = userEvent.setup();
    renderInProvider(<SyncToggle settingKey="snapMinutes" />);

    await user.click(screen.getByRole("button", { name: "Sync this setting" }));

    expect(storedOverrides()).toEqual({ snapMinutes: true });
  });
});

describe("SettingsLabel sync icon", () => {
  it("appears for syncable settings", () => {
    renderInProvider(<SettingsLabel settingKey="defaultView" />);

    expect(
      screen.getByRole("button", { name: "Sync this setting" }),
    ).toBeInTheDocument();
  });

  it("is absent for device-local settings", () => {
    renderInProvider(<SettingsLabel settingKey="resyncIntervalMinutes" />);

    expect(
      screen.queryByRole("button", { name: "Sync this setting" }),
    ).not.toBeInTheDocument();
  });

  it("is absent for offline accounts", () => {
    userMock.user = { type: "offline" };
    renderInProvider(<SettingsLabel settingKey="defaultView" />);

    expect(
      screen.queryByRole("button", { name: "Sync this setting" }),
    ).not.toBeInTheDocument();
  });
});

function Harness() {
  const sectionRefs: SectionRefs = useRef(new Map());
  return <SyncPage sectionRefs={sectionRefs} />;
}

const renderSyncPage = () => renderInProvider(<Harness />);

const master = () => screen.getByRole("switch", { name: "Sync settings" });
const groupSwitch = (name: string) =>
  screen.getByRole("switch", { name: `Sync ${name.toLowerCase()} settings` });

describe("SyncPage settings sync section", () => {
  it("has sync turned on to start with", () => {
    renderSyncPage();

    expect(master()).toBeChecked();
  });

  it("shows a reset button only on groups that differ from their defaults", async () => {
    const user = userEvent.setup();
    renderSyncPage();
    expect(
      screen.queryByRole("button", { name: "Reset to default" }),
    ).not.toBeInTheDocument();

    await user.click(groupSwitch("Events"));

    expect(
      screen.getAllByRole("button", { name: "Reset to default" }),
    ).toHaveLength(1);
  });

  it("resets a group's sync choices to the defaults", async () => {
    const user = userEvent.setup();
    renderSyncPage();
    await user.click(groupSwitch("Events"));
    await user.click(groupSwitch("Appearance"));

    await user.click(
      screen.getAllByRole("button", { name: "Reset to default" })[0],
    );

    // Appearance is listed first, so its reset was clicked and Events is untouched
    expect(groupSwitch("Appearance")).not.toBeChecked();
    expect(groupSwitch("Events")).not.toBeChecked();
    expect(storedOverrides()).toEqual({
      defaultEventName: false,
      defaultTaskName: false,
      defaultEventDuration: false,
      eventColorPresets: false,
      addColorsAutomatically: false,
      eventEditorOpacity: false,
      eventEditorBlur: false,
      eventEditorRadius: false,
    });
  });

  it("hides the reset button again once a group is back at its defaults", async () => {
    const user = userEvent.setup();
    renderSyncPage();
    await user.click(groupSwitch("Events"));
    await user.click(groupSwitch("Events"));

    expect(
      screen.queryByRole("button", { name: "Reset to default" }),
    ).not.toBeInTheDocument();
    expect(storedOverrides()).toEqual({});
  });

  it("checks a group switch only when every setting in it syncs", () => {
    renderSyncPage();

    expect(groupSwitch("Events")).toBeChecked();
    expect(groupSwitch("Calendar")).not.toBeChecked();
    expect(groupSwitch("Appearance")).not.toBeChecked();
  });

  it("turns a whole group on and stores only the differences from the defaults", async () => {
    const user = userEvent.setup();
    renderSyncPage();

    await user.click(groupSwitch("Appearance"));

    expect(groupSwitch("Appearance")).toBeChecked();
    expect(storedOverrides()).toEqual({
      theme: true,
      colors: true,
      fontFamily: true,
      fontSize: true,
    });
  });

  it("turns a whole group off", async () => {
    const user = userEvent.setup();
    renderSyncPage();

    await user.click(groupSwitch("Events"));

    expect(groupSwitch("Events")).not.toBeChecked();
    expect(storedOverrides()).toEqual({
      defaultEventName: false,
      defaultTaskName: false,
      defaultEventDuration: false,
      eventColorPresets: false,
      addColorsAutomatically: false,
      eventEditorOpacity: false,
      eventEditorBlur: false,
      eventEditorRadius: false,
    });
  });

  it("finishes a partly synced group when its switch is turned on", async () => {
    const user = userEvent.setup();
    renderSyncPage();

    // snapMinutes is the one calendar setting that does not sync by default
    await user.click(groupSwitch("Calendar"));

    expect(groupSwitch("Calendar")).toBeChecked();
    expect(storedOverrides()).toEqual({ snapMinutes: true });
  });

  it("lists a group's settings when it is expanded and toggles them one by one", async () => {
    const user = userEvent.setup();
    renderSyncPage();

    expect(
      screen.queryByRole("switch", { name: "Sync snap to minutes" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Calendar/ }));
    const snap = screen.getByRole("switch", { name: "Sync snap to minutes" });
    expect(snap).not.toBeChecked();

    await user.click(snap);

    expect(snap).toBeChecked();
    expect(storedOverrides()).toEqual({ snapMinutes: true });
    expect(groupSwitch("Calendar")).toBeChecked();
  });

  it("turns everything off with the master switch and disables the other switches", async () => {
    const user = userEvent.setup();
    renderSyncPage();

    await user.click(master());

    expect(master()).not.toBeChecked();
    expect(readSettingsMeta().syncEnabled).toBe(false);
    for (const name of ["Appearance", "Calendar", "Events", "Time zones"]) {
      expect(groupSwitch(name)).toBeDisabled();
    }
  });

  it("also disables the per-setting switches while the master switch is off", async () => {
    const user = userEvent.setup();
    renderSyncPage();
    await user.click(screen.getByRole("button", { name: /Calendar/ }));
    const snap = screen.getByRole("switch", { name: "Sync snap to minutes" });
    expect(snap).toBeEnabled();

    await user.click(master());

    expect(snap).toBeDisabled();
  });

  it("keeps the individual choices while the master switch is off", async () => {
    const user = userEvent.setup();
    renderSyncPage();
    await user.click(groupSwitch("Events"));
    const overrides = storedOverrides();

    await user.click(master());
    expect(storedOverrides()).toEqual(overrides);

    await user.click(master());
    expect(master()).toBeChecked();
    expect(storedOverrides()).toEqual(overrides);
    expect(groupSwitch("Events")).not.toBeChecked();
  });
});
