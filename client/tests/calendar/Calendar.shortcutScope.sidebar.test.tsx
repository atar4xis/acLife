import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AgendaList from "../../src/components/calendar/AgendaList.tsx";
import AppCalendar from "../../src/components/calendar/Calendar.tsx";
import { CalendarProvider } from "../../src/context/CalendarContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import { SidebarProvider } from "../../src/components/ui/sidebar.tsx";
import { buildSecondEvent, setupCalendarTests } from "./helpers";

setupCalendarTests();

const renderWithSidebar = () => {
  const user = userEvent.setup();

  render(
    <SettingsStoreProvider>
      <CalendarProvider>
        <SidebarProvider>
          <button type="button">Plain sidebar button</button>
          <AgendaList />
        </SidebarProvider>
        <AppCalendar
          events={[buildSecondEvent()]}
          mode="day"
          setMode={vi.fn()}
          saveEvents={vi.fn()}
          syncEvents={vi.fn()}
          syncBuckets={vi.fn()}
          saveDebounceMs={0}
        />
      </CalendarProvider>
    </SettingsStoreProvider>,
  );

  return { user };
};

describe("Calendar shortcuts with focus in the sidebar", () => {
  it("changes date with focus on a plain sidebar button", async () => {
    const { user } = renderWithSidebar();
    await screen.findByText("Wed 18");

    await user.click(
      screen.getByRole("button", { name: "Plain sidebar button" }),
    );
    await user.keyboard("{ArrowRight}");

    expect(await screen.findByText("Thu 19")).toBeInTheDocument();
  });

  it("changes date with focus on an agenda item button", async () => {
    const { user } = renderWithSidebar();
    await screen.findByText("Wed 18");

    const agendaButton = screen
      .getAllByText("Retro")
      .map((node) => node.closest("button"))
      .find((button) => button !== null)!;
    await user.click(agendaButton);
    expect(agendaButton).toHaveFocus();
    await user.keyboard("{ArrowRight}");

    expect(await screen.findByText("Thu 19")).toBeInTheDocument();
  });

  it("does not change date from a slider in the sidebar", async () => {
    renderWithSidebar();
    await screen.findByText("Wed 18");
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    slider.tabIndex = 0;
    document.body.appendChild(slider);
    slider.focus();

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByText("Wed 18")).toBeInTheDocument();
    expect(screen.queryByText("Thu 19")).not.toBeInTheDocument();
  });
});
