import { beforeEach, describe, expect, it } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { toast } from "sonner";
import RegionPage from "../../src/components/settings/pages/RegionPage.tsx";
import { CalendarProvider } from "../../src/context/CalendarContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import type { SectionRefs } from "../../src/components/settings/SettingsSection.tsx";
import { getDeviceTimezone } from "../../src/lib/calendar/timezone.ts";
import { dispatchWindowPointer, makeRect } from "./helpers.tsx";
import { seedSettings, readSettings } from "../settingsStorage.ts";

function Harness() {
  const sectionRefs: SectionRefs = useRef(new Map());
  return <RegionPage sectionRefs={sectionRefs} />;
}

const renderCalendarPage = () =>
  render(
    <SettingsStoreProvider>
      <CalendarProvider>
        <Harness />
      </CalendarProvider>
    </SettingsStoreProvider>,
  );

const seedTimezones = (timezones: string[], defaultTimezone: string) => {
  seedSettings({ timezones, defaultTimezone });
};

const getStoredTimezones = (): string[] => readSettings().timezones;

const getStoredDefaultTimezone = (): string => readSettings().defaultTimezone;

// each additional-time-zone row renders [grip handle, "Set default", remove]
const getAdditionalRow = (label: string | RegExp) => {
  const row = screen.getByText(label).closest("div")!;
  return {
    row,
    buttons: within(row).getAllByRole("button"),
  };
};

// options only render once the debounced search has a query
const pickTimezone = async (
  user: ReturnType<typeof userEvent.setup>,
  trigger: HTMLElement,
  query: string,
  name: RegExp,
) => {
  await user.click(trigger);
  await user.type(screen.getByPlaceholderText(/search/i), query);
  await user.click(await screen.findByRole("option", { name }));
};

describe("RegionPage time zones", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.scrollIntoView = () => {};
  });

  it("defaults to the device time zone with no additional time zones", async () => {
    renderCalendarPage();

    expect(screen.queryByText("Set default")).not.toBeInTheDocument();
    const [, , defaultTrigger] = screen.getAllByRole("combobox");
    // the time zone list loads in the background
    await waitFor(() =>
      expect(defaultTrigger).toHaveTextContent(
        getDeviceTimezone().split("/").pop()!.replace(/_/g, " "),
      ),
    );
  });

  it("adds a time zone immediately when picked from the add select, without a separate add button", async () => {
    const user = userEvent.setup();
    seedTimezones(["America/Chicago"], "America/Chicago");
    renderCalendarPage();

    expect(screen.queryByText(/tokyo, japan/i)).not.toBeInTheDocument();

    const [, , , addTrigger] = screen.getAllByRole("combobox");
    await pickTimezone(user, addTrigger, "tokyo", /tokyo, japan/i);

    expect(await screen.findByText(/tokyo, japan/i)).toBeInTheDocument();
    expect(getStoredTimezones()).toEqual(["America/Chicago", "Asia/Tokyo"]);
  });

  it("does not add the previous default as an additional time zone when changing the default via the select", async () => {
    const user = userEvent.setup();
    seedTimezones(["America/Chicago", "Asia/Tokyo"], "America/Chicago");
    renderCalendarPage();

    const [, , defaultTrigger] = screen.getAllByRole("combobox");
    await pickTimezone(
      user,
      defaultTrigger,
      "london",
      /london, united kingdom/i,
    );

    expect(getStoredDefaultTimezone()).toBe("Europe/London");
    expect(getStoredTimezones()).toEqual(["Europe/London", "Asia/Tokyo"]);
    expect(screen.queryByText(/chicago/i)).not.toBeInTheDocument();
  });

  it("shows a success toast naming the new default time zone", async () => {
    const user = userEvent.setup();
    seedTimezones(["America/Chicago"], "America/Chicago");
    renderCalendarPage();

    const [, , defaultTrigger] = screen.getAllByRole("combobox");
    await pickTimezone(user, defaultTrigger, "tokyo", /tokyo, japan/i);

    expect(toast.success).toHaveBeenCalledWith(
      "Time zone set to Tokyo, Japan (also Australia)",
    );
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
      screen.getByText("The limit of 6 time zones has been reached"),
    ).toBeInTheDocument();

    const [, , , addTrigger] = screen.getAllByRole("combobox");
    expect(addTrigger).toBeDisabled();
  });

  it("reorders additional time zones by dragging, which updates the grid order", () => {
    seedTimezones(["UTC", "Asia/Tokyo", "Europe/London"], "UTC");
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

  it("reorders additional time zones with a realistic multi-step mouse drag over position-based row layout", () => {
    seedTimezones(
      ["UTC", "Asia/Tokyo", "Europe/London", "America/Chicago"],
      "UTC",
    );
    renderCalendarPage();

    // rows are laid out by DOM position, like a real flex column
    const rows = ["tokyo, japan", "london, united kingdom", "chicago"].map(
      (name) => getAdditionalRow(new RegExp(name, "i")).row,
    );
    const container = rows[0].parentElement!;
    const rowHeight = 40;
    for (const row of rows) {
      row.getBoundingClientRect = () => {
        const top = [...container.children].indexOf(row) * rowHeight;
        return makeRect(0, top, 300, rowHeight - 6);
      };
    }
    const grip = within(rows[0]).getAllByRole("button")[0];

    fireEvent.pointerDown(grip, {
      button: 0,
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    for (let y = 10; y <= 100; y += 10) {
      dispatchWindowPointer("pointermove", {
        pointerType: "mouse",
        clientX: 10,
        clientY: y,
      });
    }
    dispatchWindowPointer("pointerup", {
      pointerType: "mouse",
      clientX: 10,
      clientY: 100,
    });

    expect(getStoredTimezones()).toEqual([
      "UTC",
      "Europe/London",
      "America/Chicago",
      "Asia/Tokyo",
    ]);
  });
});
