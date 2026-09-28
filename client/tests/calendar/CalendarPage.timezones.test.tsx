import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { toast } from "sonner";
import CalendarPage from "../../src/components/settings/pages/CalendarPage.tsx";
import { CalendarSettingsProvider } from "../../src/context/CalendarSettingsContext.tsx";
import type { SectionRefs } from "../../src/components/settings/SettingsSection.tsx";
import { getDeviceTimezone } from "../../src/lib/calendar/timezone.ts";
import { dispatchWindowPointer, makeRect } from "./helpers.tsx";

const STORAGE_KEY = "acl-calendar-settings";

function Harness() {
  const sectionRefs: SectionRefs = useRef(new Map());
  return <CalendarPage sectionRefs={sectionRefs} />;
}

const renderCalendarPage = () =>
  render(
    <CalendarSettingsProvider>
      <Harness />
    </CalendarSettingsProvider>,
  );

const seedTimezones = (timezones: string[], defaultTimezone: string) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ timezones, defaultTimezone }),
  );
};

const getStoredTimezones = (): string[] =>
  JSON.parse(localStorage.getItem(STORAGE_KEY)!).timezones;

const getStoredDefaultTimezone = (): string =>
  JSON.parse(localStorage.getItem(STORAGE_KEY)!).defaultTimezone;

// each additional-time-zone row renders [grip handle, "Set default", remove]
const getAdditionalRow = (label: string) => {
  const row = screen.getByText(label).closest("div")!;
  return {
    row,
    buttons: within(row).getAllByRole("button"),
  };
};

describe("CalendarPage time zones", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.scrollIntoView = () => {};
  });

  it("defaults to the device time zone with no additional time zones", () => {
    renderCalendarPage();

    expect(screen.queryByText("Set default")).not.toBeInTheDocument();
    const [defaultTrigger] = screen.getAllByRole("combobox");
    expect(defaultTrigger).toHaveTextContent(
      getDeviceTimezone().split("/").pop()!.replace(/_/g, " "),
    );
  });

  it("adds a time zone immediately when picked from the add select, without a separate add button", async () => {
    const user = userEvent.setup();
    seedTimezones(["America/Chicago"], "America/Chicago");
    renderCalendarPage();

    expect(screen.queryByText(/tokyo, japan/i)).not.toBeInTheDocument();

    const [, addTrigger] = screen.getAllByRole("combobox");
    await user.click(addTrigger);
    const option = await screen.findByRole("option", {
      name: /tokyo, japan/i,
    });
    await user.click(option);

    expect(await screen.findByText(/tokyo, japan/i)).toBeInTheDocument();
    expect(getStoredTimezones()).toEqual(["America/Chicago", "Asia/Tokyo"]);
  });

  it("does not add the previous default as an additional time zone when changing the default via the select", async () => {
    const user = userEvent.setup();
    seedTimezones(["America/Chicago", "Asia/Tokyo"], "America/Chicago");
    renderCalendarPage();

    const [defaultTrigger] = screen.getAllByRole("combobox");
    await user.click(defaultTrigger);
    const option = await screen.findByRole("option", {
      name: /london, united kingdom/i,
    });
    await user.click(option);

    expect(getStoredDefaultTimezone()).toBe("Europe/London");
    expect(getStoredTimezones()).toEqual(["Europe/London", "Asia/Tokyo"]);
    expect(screen.queryByText(/chicago/i)).not.toBeInTheDocument();
  });

  it("shows a success toast naming the new default time zone", async () => {
    const user = userEvent.setup();
    seedTimezones(["America/Chicago"], "America/Chicago");
    renderCalendarPage();

    const [defaultTrigger] = screen.getAllByRole("combobox");
    await user.click(defaultTrigger);
    const option = await screen.findByRole("option", {
      name: /tokyo, japan/i,
    });
    await user.click(option);

    expect(toast.success).toHaveBeenCalledWith("Time zone set to Tokyo, Japan (also Australia)");
  });

  it("promotes an additional time zone to default and demotes the previous default into its slot", async () => {
    const user = userEvent.setup();
    seedTimezones(
      ["America/Chicago", "Asia/Tokyo", "Europe/London"],
      "America/Chicago",
    );
    renderCalendarPage();

    const { buttons } = getAdditionalRow(/tokyo, japan/i);
    await user.click(buttons[1]); // "Set default"

    expect(getStoredDefaultTimezone()).toBe("Asia/Tokyo");
    // Tokyo's old slot now holds the previous default, London is unmoved
    expect(getStoredTimezones()).toEqual([
      "Asia/Tokyo",
      "America/Chicago",
      "Europe/London",
    ]);
  });

  it("removes an additional time zone", async () => {
    const user = userEvent.setup();
    seedTimezones(["America/Chicago", "Asia/Tokyo"], "America/Chicago");
    renderCalendarPage();

    const { buttons } = getAdditionalRow(/tokyo, japan/i);
    await user.click(buttons[2]); // remove

    expect(screen.queryByText(/tokyo, japan/i)).not.toBeInTheDocument();
    expect(getStoredTimezones()).toEqual(["America/Chicago"]);
  });

  it("disables the add select and shows a message once the maximum is reached", () => {
    seedTimezones(
      [
        "UTC",
        "Asia/Tokyo",
        "Europe/London",
        "America/Chicago",
        "Australia/Sydney",
        "Africa/Cairo",
      ],
      "UTC",
    );
    renderCalendarPage();

    expect(
      screen.getByText("Maximum of 6 time zones reached"),
    ).toBeInTheDocument();

    const [, addTrigger] = screen.getAllByRole("combobox");
    expect(addTrigger).toBeDisabled();
  });

  it("reorders additional time zones by dragging, which updates the grid order", () => {
    seedTimezones(
      ["UTC", "Asia/Tokyo", "Europe/London"],
      "UTC",
    );
    renderCalendarPage();

    // pointer-based drag hit-tests rects, so give each row a distinct one
    const tokyoRow = getAdditionalRow(/tokyo, japan/i);
    const londonRow = getAdditionalRow(/london, united kingdom/i);
    tokyoRow.row.getBoundingClientRect = () => makeRect(0, 0, 100, 40);
    londonRow.row.getBoundingClientRect = () => makeRect(0, 40, 100, 40);
    const grip = tokyoRow.buttons[0];

    fireEvent.pointerDown(grip, { clientX: 10, clientY: 10 });
    dispatchWindowPointer("pointermove", { clientX: 10, clientY: 60 });
    dispatchWindowPointer("pointerup", { clientX: 10, clientY: 60 });

    expect(getStoredTimezones()).toEqual([
      "UTC",
      "Europe/London",
      "Asia/Tokyo",
    ]);
  });
});
