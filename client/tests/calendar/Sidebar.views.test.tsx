import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ user: { type: "offline" }, logout: vi.fn() }),
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ get: () => true, set: vi.fn() }),
}));

import AppSidebar from "../../src/components/Sidebar.tsx";
import { SidebarProvider } from "../../src/components/ui/sidebar.tsx";
import { CalendarProvider } from "../../src/context/CalendarContext.tsx";
import { JournalProvider } from "../../src/context/JournalContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import type { AppView } from "../../src/types/AppView.ts";

const renderSidebar = (view: AppView, onChangeView = vi.fn()) => {
  render(
    <SettingsStoreProvider>
      <CalendarProvider>
        <JournalProvider>
          <SidebarProvider>
            <AppSidebar
              view={view}
              onChangeView={onChangeView}
              onOpenSettings={vi.fn()}
            />
          </SidebarProvider>
        </JournalProvider>
      </CalendarProvider>
    </SettingsStoreProvider>,
  );
  return onChangeView;
};

describe("sidebar view switcher", () => {
  it("offers the journal on the calendar and switches to it", async () => {
    const onChangeView = renderSidebar("calendar");

    expect(screen.queryByRole("button", { name: "Calendar" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Journal" }));
    expect(onChangeView).toHaveBeenCalledWith("journal");
  });

  it("offers the calendar on the journal and switches to it", async () => {
    const onChangeView = renderSidebar("journal");

    expect(screen.queryByRole("button", { name: "Journal" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(onChangeView).toHaveBeenCalledWith("calendar");
  });
});
