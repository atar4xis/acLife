import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecurringUpdateDialog from "../../src/components/calendar/RecurringUpdateDialog.tsx";

const dialog = (open: boolean, onSubmit = vi.fn()) => (
  <RecurringUpdateDialog
    action="Update"
    defaultOption="this"
    open={open}
    setOpen={vi.fn()}
    canKeepChanges
    onSubmit={onSubmit}
    onCancel={vi.fn()}
  />
);

describe("RecurringUpdateDialog keep changes", () => {
  it("reports the checkbox with the chosen option", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(dialog(true, onSubmit));

    await user.click(screen.getByRole("radio", { name: /future/i }));
    await user.click(screen.getByRole("checkbox", { name: /keep changes to future events/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));

    expect(onSubmit).toHaveBeenCalledWith("future", true);
  });

  it("is unchecked again after the dialog closes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(dialog(true));

    await user.click(screen.getByRole("radio", { name: /future/i }));
    await user.click(screen.getByRole("checkbox", { name: /keep changes to future events/i }));
    rerender(dialog(false));
    rerender(dialog(true));

    expect(
      screen.getByRole("checkbox", { name: /keep changes to future events/i }),
    ).not.toBeChecked();
  });
});
