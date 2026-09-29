import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import CalendarPage from "../../src/components/settings/pages/CalendarPage.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import type { SectionRefs } from "../../src/components/settings/SettingsSection.tsx";
import { readSettings } from "../settingsStorage.ts";

function Harness() {
  const sectionRefs: SectionRefs = useRef(new Map());
  return <CalendarPage sectionRefs={sectionRefs} />;
}

const renderCalendarPage = () =>
  render(
    <SettingsStoreProvider>
      <Harness />
    </SettingsStoreProvider>,
  );

describe("CalendarPage", () => {
  beforeEach(() => {
    // radix Select relies on pointer capture, which jsdom doesn't implement
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.scrollIntoView = () => {};
  });

  it("renders current default view and week start selections", () => {
    renderCalendarPage();

    expect(screen.getByText("Week")).toBeInTheDocument();
    expect(screen.getByText("Inherit from time zone")).toBeInTheDocument();
  });

  it("renders the current snap minutes and default event duration", () => {
    renderCalendarPage();

    expect(screen.getByText("5 min")).toBeInTheDocument();
    expect(screen.getByText("60 min")).toBeInTheDocument();
  });

  it("renders default event and task name inputs with their stored values", () => {
    renderCalendarPage();

    expect(screen.getByDisplayValue("new event")).toBeInTheDocument();
    expect(screen.getByDisplayValue("new task")).toBeInTheDocument();
  });

  it("updates the default event name as the user types", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const input = screen.getByDisplayValue("new event");
    await user.clear(input);
    await user.type(input, "standup");

    expect(screen.getByDisplayValue("standup")).toBeInTheDocument();
  });

  it("updates the default task name as the user types", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const input = screen.getByDisplayValue("new task");
    await user.clear(input);
    await user.type(input, "todo");

    expect(screen.getByDisplayValue("todo")).toBeInTheDocument();
  });

  it("changes the default view via the select", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    // index 0 is week start, 1/2 are the "Default time zone" and "Add a time zone" selects
    const [, , , viewTrigger] = screen.getAllByRole("combobox");
    await user.click(viewTrigger);
    const options = await screen.findAllByText("Day");
    await user.click(options[options.length - 1]);

    expect(await screen.findByText("Day")).toBeInTheDocument();
  });

  it("changes the week start via the select", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const [weekStartTrigger] = screen.getAllByRole("combobox");
    await user.click(weekStartTrigger);
    const options = await screen.findAllByText("Sunday");
    await user.click(options[options.length - 1]);

    expect(await screen.findByText("Sunday")).toBeInTheDocument();
  });

  it("shows what inherit resolves to below the week start select, hiding it for an explicit day", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    expect(screen.getByText(/^Currently \w+day$/)).toBeInTheDocument();

    const [weekStartTrigger] = screen.getAllByRole("combobox");
    await user.click(weekStartTrigger);
    await user.click(await screen.findByRole("option", { name: "Monday" }));

    expect(screen.queryByText(/^Currently /)).not.toBeInTheDocument();
  });

  it("lists week start days beginning with Saturday", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const [weekStartTrigger] = screen.getAllByRole("combobox");
    await user.click(weekStartTrigger);
    const options = await screen.findAllByRole("option");

    expect(options.map((o) => o.textContent)).toEqual([
      "Inherit from time zone",
      "Saturday",
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]);
  });

  it("increases the snap minutes slider with the keyboard", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const sliders = screen.getAllByRole("slider");
    sliders[0].focus();
    await user.keyboard("[ArrowRight]");

    expect(screen.getByText("6 min")).toBeInTheDocument();
  });

  it("increases the default event duration slider with the keyboard", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const sliders = screen.getAllByRole("slider");
    sliders[1].focus();
    await user.keyboard("[ArrowRight]");

    expect(screen.getByText("61 min")).toBeInTheDocument();
  });

  it("renders the agenda enabled switch on by default and the default range", () => {
    renderCalendarPage();

    const switches = screen.getAllByRole("switch");
    expect(switches[switches.length - 1]).toBeChecked();
    expect(screen.getByText("3 days")).toBeInTheDocument();
  });

  it("toggles the agenda enabled switch off", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const switches = screen.getAllByRole("switch");
    const agendaSwitch = switches[switches.length - 1];
    await user.click(agendaSwitch);

    expect(agendaSwitch).not.toBeChecked();

    const stored = readSettings();
    expect(stored.agendaEnabled).toBe(false);
  });

  it("increases the agenda range slider with the keyboard", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const sliders = screen.getAllByRole("slider");
    sliders[sliders.length - 1].focus();
    await user.keyboard("[ArrowRight]");

    expect(screen.getByText("4 days")).toBeInTheDocument();

    const stored = readSettings();
    expect(stored.agendaRangeDays).toBe(4);
  });

  it("clamps the agenda range slider between 1 and 14 days", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const sliders = screen.getAllByRole("slider");
    const rangeSlider = sliders[sliders.length - 1];
    rangeSlider.focus();

    for (let i = 0; i < 20; i++) {
      await user.keyboard("[ArrowRight]");
    }

    expect(screen.getByText("14 days")).toBeInTheDocument();
  });

  it("persists changes made through the page to localStorage", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const input = screen.getByDisplayValue("new event");
    await user.clear(input);
    await user.type(input, "focus block");

    // auto-save is debounced, so wait for the commit
    await waitFor(() => {
      const stored = readSettings();
      expect(stored.defaultEventName).toBe("focus block");
    });
  });

  it("persists a default event name edit immediately on blur, without waiting for the debounce", async () => {
    const user = userEvent.setup();
    renderCalendarPage();

    const input = screen.getByDisplayValue("new event");
    await user.clear(input);
    await user.type(input, "focus block");
    await user.tab();

    const stored = readSettings();
    expect(stored.defaultEventName).toBe("focus block");
  });
});
