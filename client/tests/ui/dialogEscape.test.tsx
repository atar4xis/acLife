import RenameInput from "@/components/journal/RenameInput";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

const onDone = vi.fn();

function Harness() {
  const [open, setOpen] = useState(true);
  if (!open) return <p>closed</p>;

  return (
    <Dialog open onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Title</DialogTitle>
        <RenameInput name="Ann" label="Nickname" onDone={onDone} />
        <button type="button">Other</button>
      </DialogContent>
    </Dialog>
  );
}

describe("Escape in a dialog", () => {
  it("cancels a rename without closing the dialog", async () => {
    onDone.mockClear();
    render(<Harness />);
    const user = userEvent.setup();

    await user.keyboard("{Escape}");

    expect(onDone).toHaveBeenCalledWith(undefined);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("still closes the dialog from anywhere else", async () => {
    render(<Harness />);
    const user = userEvent.setup();

    screen.getByRole("button", { name: "Other" }).focus();
    await user.keyboard("{Escape}");

    expect(screen.getByText("closed")).toBeTruthy();
  });
});
