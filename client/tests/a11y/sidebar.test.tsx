import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoViolations } from "./axe.ts";

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ user: { type: "offline" }, logout: vi.fn() }),
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ get: () => true, set: vi.fn() }),
}));

import AppSidebar from "../../src/components/Sidebar.tsx";
import { SidebarProvider } from "../../src/components/ui/sidebar.tsx";
import { CalendarProvider } from "../../src/context/CalendarContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";

describe("Sidebar a11y", () => {
  it("has named icon buttons and no axe violations", async () => {
    const { container } = render(
      <SettingsStoreProvider>
        <CalendarProvider>
          <SidebarProvider>
            <AppSidebar view="calendar" onChangeView={vi.fn()} onOpenSettings={vi.fn()} />
          </SidebarProvider>
        </CalendarProvider>
      </SettingsStoreProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "User menu" }),
    ).toBeInTheDocument();
    await expectNoViolations(container);
  });
});
