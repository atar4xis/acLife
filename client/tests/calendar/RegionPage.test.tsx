import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyFormats, applyLanguage, fmt } from "../../src/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import LanguageSync from "../../src/components/LanguageSync.tsx";
import RegionPage from "../../src/components/settings/pages/RegionPage.tsx";
import { CalendarProvider } from "../../src/context/CalendarContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import type { SectionRefs } from "../../src/components/settings/SettingsSection.tsx";
import { readSettings, seedSettings } from "../settingsStorage.ts";

function Harness() {
  const sectionRefs: SectionRefs = useRef(new Map());
  return <RegionPage sectionRefs={sectionRefs} />;
}

const renderRegionPage = () =>
  render(
    <SettingsStoreProvider>
      <LanguageSync />
      <CalendarProvider>
        <Harness />
      </CalendarProvider>
    </SettingsStoreProvider>,
  );

describe("RegionPage", () => {
  afterEach(() => {
    applyLanguage("en");
    applyFormats({});
  });

  beforeEach(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.scrollIntoView = () => {};
  });

  it("stores the chosen language and translates the page", async () => {
    const user = userEvent.setup();
    renderRegionPage();

    const [languageTrigger] = screen.getAllByRole("combobox");
    await user.click(languageTrigger);
    await user.click(await screen.findByRole("option", { name: "Español" }));

    expect(readSettings().language).toBe("es");
    expect(await screen.findAllByText("Idioma")).not.toHaveLength(0);
    expect(screen.getByText("Seguir la zona horaria")).toBeInTheDocument();
  });


  it("changes the week start via the select", async () => {
    const user = userEvent.setup();
    renderRegionPage();

    const [, weekStartTrigger] = screen.getAllByRole("combobox");
    await user.click(weekStartTrigger);
    const options = await screen.findAllByText("Sunday");
    await user.click(options[options.length - 1]);

    expect(await screen.findByText("Sunday")).toBeInTheDocument();
  });

  it("shows what inherit resolves to below the week start select, hiding it for an explicit day", async () => {
    const user = userEvent.setup();
    renderRegionPage();

    expect(screen.getByText(/^Currently \w+day$/)).toBeInTheDocument();

    const [, weekStartTrigger] = screen.getAllByRole("combobox");
    await user.click(weekStartTrigger);
    await user.click(await screen.findByRole("option", { name: "Monday" }));

    expect(screen.queryByText(/^Currently /)).not.toBeInTheDocument();
  });

  it("lists week start days beginning with Saturday", async () => {
    const user = userEvent.setup();
    renderRegionPage();

    const [, weekStartTrigger] = screen.getAllByRole("combobox");
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


  it("lists the time format above the date format in a Formats section", () => {
    renderRegionPage();

    expect(screen.getByText("Formats")).toBeInTheDocument();
    expect(screen.queryByText("Locale")).not.toBeInTheDocument();
    const time = screen.getByText("Time format");
    const date = screen.getByText("Date format");
    expect(
      time.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows one format reference, next to the Formats heading", () => {
    renderRegionPage();

    const help = screen.getAllByRole("button", { name: "Format reference" });
    expect(help).toHaveLength(1);
    expect(help[0].parentElement).toContainElement(
      screen.getByRole("heading", { name: "Formats" }),
    );
  });

  it("shows the language's time pattern with a preview and stores a custom one", async () => {
    const user = userEvent.setup();
    renderRegionPage();

    const input = screen.getByDisplayValue("h:mm a");
    expect(screen.getByText(/^\d{1,2}:\d{2} (AM|PM)$/)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "HH:mm");
    await user.tab();

    expect(readSettings().timeFormat).toBe("HH:mm");
    expect(fmt("time")).toBe("HH:mm");
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("falls back to the language's time pattern when the format is cleared", async () => {
    const user = userEvent.setup();
    seedSettings({ timeFormat: "HH:mm" });
    renderRegionPage();

    await user.clear(screen.getByDisplayValue("HH:mm"));
    await user.tab();

    expect(readSettings().timeFormat).toBe("");
    expect(fmt("time")).toBe("h:mm a");
  });

  it("shows the chosen time in the date and time default", async () => {
    const user = userEvent.setup();
    renderRegionPage();

    const input = screen.getByDisplayValue("h:mm a");
    await user.clear(input);
    await user.type(input, "HH:mm");
    await user.tab();

    expect(
      await screen.findByDisplayValue("EEE, MMM d yyyy, HH:mm"),
    ).toBeInTheDocument();
    expect(readSettings().dateTimeFormat).toBe("");
  });

  it("shows the language's date pattern by default and stores a custom one", async () => {
    const user = userEvent.setup();
    renderRegionPage();

    const input = screen.getByDisplayValue("dd LLL yyyy");
    await user.clear(input);
    await user.type(input, "yyyy-MM-dd");
    await user.tab();

    expect(readSettings().dateFormat).toBe("yyyy-MM-dd");
    expect(fmt("date")).toBe("yyyy-MM-dd");
  });

  it("falls back to the language's pattern when the format is cleared", async () => {
    const user = userEvent.setup();
    seedSettings({ dateFormat: "yyyy-MM-dd" });
    renderRegionPage();

    await user.clear(screen.getByDisplayValue("yyyy-MM-dd"));
    await user.tab();

    expect(readSettings().dateFormat).toBe("");
    expect(fmt("date")).toBe("dd LLL yyyy");
  });

  it("retranslates time zone details right after the language changes", async () => {
    const user = userEvent.setup();
    renderRegionPage();

    const [languageTrigger, , , addTrigger] =
      screen.getAllByRole("combobox");
    await user.click(languageTrigger);
    await user.click(await screen.findByRole("option", { name: "Español" }));
    await screen.findAllByText("Idioma");

    await user.click(addTrigger);
    await user.type(screen.getByPlaceholderText(/escribe/i), "tokyo");
    expect(
      await screen.findByRole("option", { name: /tokyo, japón/i }),
    ).toBeInTheDocument();
  });
});
