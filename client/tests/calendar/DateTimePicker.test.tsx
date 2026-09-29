import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import { DateTimePicker } from "../../src/components/calendar/DateTimePicker.tsx";
import { seedSettings } from "../settingsStorage.ts";

// 2026-03-15 01:00 in Tokyo, which is still 2026-03-14 in the UTC test environment
const value = new Date("2026-03-14T16:00:00Z");

const renderPicker = (onChange = vi.fn()) => {
  seedSettings({
      timezones: ["Asia/Tokyo"],
      defaultTimezone: "Asia/Tokyo",
    });
  render(
    <SettingsStoreProvider>
      <DateTimePicker value={value} onChange={onChange} />
    </SettingsStoreProvider>,
  );
  return onChange;
};

describe("DateTimePicker", () => {
  it("highlights the day in the default time zone, not the browser's", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("button", { name: /15 Mar 2026/ }));

    const selected = screen.getByRole("gridcell", { selected: true });
    expect(selected).toHaveTextContent("15");
    expect(screen.getByText("March 2026")).toBeInTheDocument();
  });

  it("keeps the time of day in the default time zone when picking a date", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();

    await user.click(screen.getByRole("button", { name: /15 Mar 2026/ }));
    await user.click(screen.getByRole("button", { name: /March 20th/ }));

    // 2026-03-20 01:00 in Tokyo
    expect(onChange).toHaveBeenCalledWith(new Date("2026-03-19T16:00:00Z"));
  });
});
