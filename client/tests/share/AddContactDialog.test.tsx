import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

const shares = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("../../src/context/ShareContext.tsx", () => ({
  useShares: () => shares.value,
}));

import AddContactDialog from "../../src/components/sharing/AddContactDialog.tsx";

const dan = { uuid: "dan", email: "dan@example.com", publicKey: "DDDD" };

const base = () => ({
  lookupContact: vi.fn().mockResolvedValue(dan),
  trustOf: vi.fn().mockReturnValue("new"),
  pinContact: vi.fn(),
});

const renderDialog = () => {
  const onOpenChange = vi.fn();
  render(<AddContactDialog open onOpenChange={onOpenChange} />);
  return onOpenChange;
};

const typeEmail = async () => {
  const user = userEvent.setup();
  await user.type(
    screen.getByLabelText("Email address"),
    "dan@example.com",
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
  return user;
};

beforeEach(() => {
  shares.value = base();
});

describe("AddContactDialog", () => {
  it("shows the security code of a new person and adds them on confirming", async () => {
    const onOpenChange = renderDialog();
    const user = await typeEmail();

    expect(
      await screen.findByLabelText(/Security code of dan@example.com/),
    ).toBeTruthy();
    expect(shares.value.pinContact).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Add contact" }));
    expect(shares.value.pinContact).toHaveBeenCalledWith(dan);
    expect(toast.success).toHaveBeenCalledWith("Contact added.");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("adds a known person at once", async () => {
    (shares.value.trustOf as ReturnType<typeof vi.fn>).mockReturnValue("same");
    renderDialog();
    await typeEmail();

    await waitFor(() => expect(shares.value.pinContact).toHaveBeenCalledWith(dan));
  });

  it("goes back from the security code without adding", async () => {
    renderDialog();
    const user = await typeEmail();
    await screen.findByLabelText(/Security code of/);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(shares.value.pinContact).not.toHaveBeenCalled();
  });

  it("says when nobody has that email", async () => {
    (shares.value.lookupContact as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    renderDialog();
    await typeEmail();

    expect(await screen.findByText("User not found.")).toBeTruthy();
    expect(shares.value.pinContact).not.toHaveBeenCalled();
  });

  it("lets me try again when the lookup throws", async () => {
    (shares.value.lookupContact as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("offline"),
    );
    renderDialog();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Email address"),
      "dan@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("An unexpected error occurred."),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByLabelText(/Security code of dan@example.com/),
    ).toBeTruthy();
  });

  it("says when the email is my own", async () => {
    (shares.value.lookupContact as ReturnType<typeof vi.fn>).mockResolvedValue("self");
    renderDialog();
    await typeEmail();

    expect(
      await screen.findByText("Enter another person's email."),
    ).toBeTruthy();
  });
});
