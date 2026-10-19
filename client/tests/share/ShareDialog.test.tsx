import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoViolations } from "../a11y/axe.ts";

const shares = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock("../../src/context/ShareContext.tsx", () => ({
  useShares: () => shares.value,
}));

vi.mock("../../src/context/JournalContext.tsx", () => ({
  useJournal: () => ({
    itemsById: new Map([
      ["folder-1", { id: "folder-1", type: "folder", name: "Recipes", color: "rgb(0, 128, 0)", colorIcon: true }],
    ]),
  }),
}));

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

import { toast } from "sonner";
import ShareDialog from "../../src/components/sharing/ShareDialog.tsx";

const request = {
  kind: "journal",
  scope: "collection",
  target: "folder-1",
  label: "Recipes",
};

const base = () => ({
  nameOf: (_: string, email: string) => email,
  nicknames: {} as Record<string, string>,
  shareRequest: request,
  openShare: vi.fn(),
  closeShare: vi.fn(),
  owned: [] as unknown[],
  contacts: [] as unknown[],
  lookupContact: vi.fn().mockResolvedValue({ uuid: "ann", email: "ann@example.com", publicKey: "AAAA" }),
  trustOf: vi.fn().mockReturnValue("new"),
  createShare: vi.fn().mockResolvedValue("space"),
  addMember: vi.fn().mockResolvedValue(true),
  setPermission: vi.fn().mockResolvedValue(true),
  removeMember: vi.fn().mockResolvedValue(true),
  deleteSpace: vi.fn().mockResolvedValue(true),
});

const typeEmail = async (email = "ann@example.com") => {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email address"), email);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  return user;
};

beforeEach(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.releasePointerCapture = () => {};
  shares.value = base();
});

describe("ShareDialog", () => {
  it("renders nothing without a request", () => {
    shares.value = { ...base(), shareRequest: null };
    render(<ShareDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names what is shared and has no accessibility violations", async () => {
    render(<ShareDialog />);
    const dialog = screen.getByRole("dialog", { name: /Recipes/ });
    await expectNoViolations(dialog);
  });

  it("shows the code of a new person before inviting them, then creates the share", async () => {
    render(<ShareDialog />);
    const user = await typeEmail();

    expect(await screen.findByLabelText(/Security code of ann@example.com/)).toBeTruthy();
    expect(shares.value.createShare).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() =>
      expect(shares.value.createShare).toHaveBeenCalledWith({
        ...request,
        contact: { uuid: "ann", email: "ann@example.com", publicKey: "AAAA" },
        permission: "read",
      }),
    );
  });

  describe("a target prepared on demand", () => {
    const prepare = vi.fn().mockReturnValue("detached-1");

    beforeEach(() => {
      prepare.mockClear();
      shares.value = {
        ...base(),
        shareRequest: { ...request, scope: "item", target: prepare },
      };
      (shares.value.trustOf as ReturnType<typeof vi.fn>).mockReturnValue("same");
    });

    it("is not prepared until the invitation is sent, then the request points at it", async () => {
      render(<ShareDialog />);
      expect(prepare).not.toHaveBeenCalled();

      await typeEmail();

      await waitFor(() =>
        expect(shares.value.createShare).toHaveBeenCalledWith(
          expect.objectContaining({ target: "detached-1" }),
        ),
      );
      expect(shares.value.openShare).toHaveBeenCalledWith(
        expect.objectContaining({ target: "detached-1" }),
      );
    });

    it("is prepared once when the first attempt fails", async () => {
      (shares.value.createShare as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("space");
      render(<ShareDialog />);
      const user = await typeEmail();
      await waitFor(() => expect(shares.value.createShare).toHaveBeenCalledTimes(1));

      await user.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(() => expect(shares.value.createShare).toHaveBeenCalledTimes(2));
      expect(prepare).toHaveBeenCalledTimes(1);
    });
  });

  it("stays quiet when the lookup itself failed", async () => {
    (shares.value.lookupContact as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<ShareDialog />);
    await typeEmail();

    await waitFor(() => expect(shares.value.lookupContact).toHaveBeenCalled());
    expect(screen.queryByText("User not found.")).toBeNull();
  });

  it("says when the email is your own", async () => {
    (shares.value.lookupContact as ReturnType<typeof vi.fn>).mockResolvedValue("self");
    render(<ShareDialog />);
    await typeEmail();

    expect(await screen.findByText("Enter another person's email.")).toBeTruthy();
    expect(screen.queryByText("User not found.")).toBeNull();
  });

  it("tells the person once the invitation is sent", async () => {
    (shares.value.trustOf as ReturnType<typeof vi.fn>).mockReturnValue("same");
    render(<ShareDialog />);
    await typeEmail();

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Invitation sent."));
  });

  it("goes back from the code without inviting", async () => {
    render(<ShareDialog />);
    const user = await typeEmail();
    await screen.findByLabelText(/Security code of/);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(shares.value.createShare).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email address")).toBeTruthy();
  });

  it("skips the code for a person whose key is already known", async () => {
    (shares.value.trustOf as ReturnType<typeof vi.fn>).mockReturnValue("same");
    render(<ShareDialog />);
    await typeEmail();

    await waitFor(() => expect(shares.value.createShare).toHaveBeenCalled());
    expect(screen.queryByLabelText(/Security code of/)).toBeNull();
  });

  it("warns plainly when the key of a known person changed", async () => {
    (shares.value.trustOf as ReturnType<typeof vi.fn>).mockReturnValue("changed");
    render(<ShareDialog />);
    await typeEmail();

    expect(await screen.findByText(/security code for ann@example.com has changed/)).toBeTruthy();
    expect(shares.value.createShare).not.toHaveBeenCalled();
  });

  it("sends the chosen permission", async () => {
    render(<ShareDialog />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email address"), "ann@example.com");
    await user.click(screen.getByRole("combobox", { name: "Permission" }));
    await user.click(await screen.findByRole("option", { name: "Can edit" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Send invitation" }));

    await waitFor(() =>
      expect(shares.value.createShare).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "write" }),
      ),
    );
  });

  it("says when nobody has that email", async () => {
    (shares.value.lookupContact as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(<ShareDialog />);
    await typeEmail("nobody@example.com");

    expect(await screen.findByText("User not found.")).toBeTruthy();
    expect(shares.value.createShare).not.toHaveBeenCalled();
  });

  it("goes back to the email step when the share could not be made", async () => {
    (shares.value.trustOf as ReturnType<typeof vi.fn>).mockReturnValue("same");
    (shares.value.createShare as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(<ShareDialog />);
    await typeEmail();

    await waitFor(() => expect(shares.value.createShare).toHaveBeenCalled());
    expect(await screen.findByRole("textbox")).toBeTruthy();
  });

  it("reports a share that throws and lets me try again", async () => {
    (shares.value.trustOf as ReturnType<typeof vi.fn>).mockReturnValue("same");
    (shares.value.createShare as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("bad key"));
    render(<ShareDialog />);
    await typeEmail();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((await screen.findByRole("button", { name: "Continue" })).hasAttribute("disabled")).toBe(false);
  });

  it("adds to the existing space instead of creating another", async () => {
    const space = {
      id: "space",
      kind: "journal",
      scope: "collection",
      target: "folder-1",
      members: [],
    };
    shares.value = { ...base(), owned: [space] };
    (shares.value.trustOf as ReturnType<typeof vi.fn>).mockReturnValue("same");
    render(<ShareDialog />);
    await typeEmail();

    await waitFor(() =>
      expect(shares.value.addMember).toHaveBeenCalledWith(
        space,
        { uuid: "ann", email: "ann@example.com", publicKey: "AAAA" },
        "read",
      ),
    );
    expect(shares.value.createShare).not.toHaveBeenCalled();
  });

  describe("with people already added", () => {
    const space = () => ({
      id: "space",
      kind: "journal",
      scope: "collection",
      target: "folder-1",
      members: [
        { user: "bob", email: "bob@example.com", publicKey: "k", permission: "read", status: "pending" },
        { user: "cat", email: "cat@example.com", publicKey: "k", permission: "write", status: "accepted" },
      ],
    });

    beforeEach(() => {
      shares.value = { ...base(), owned: [space()] };
    });

    it("lists them and marks the ones who have not answered", () => {
      render(<ShareDialog />);
      const people = screen.getByRole("list");
      expect(within(people).getByText("bob@example.com")).toBeTruthy();
      expect(within(people).getByText("Invited")).toBeTruthy();
      expect(within(people).getAllByRole("listitem")).toHaveLength(2);
    });

    it("refuses to add the same person twice", async () => {
      render(<ShareDialog />);
      await typeEmail("BOB@example.com");

      expect(await screen.findByText("This person already has access.")).toBeTruthy();
      expect(shares.value.lookupContact).not.toHaveBeenCalled();
    });

    it("changes a permission", async () => {
      render(<ShareDialog />);
      const user = userEvent.setup();
      await user.click(screen.getByRole("combobox", { name: "Permission for bob@example.com" }));
      await user.click(await screen.findByRole("option", { name: "Can edit" }));

      expect(shares.value.setPermission).toHaveBeenCalledWith("space", "bob", "write");
    });

    it("removes a person", async () => {
      render(<ShareDialog />);
      await userEvent.click(screen.getByRole("button", { name: "Remove bob@example.com" }));
      expect(shares.value.removeMember).toHaveBeenCalledWith("space", "bob");
    });

    it("has no accessibility violations", async () => {
      render(<ShareDialog />);
      await expectNoViolations(screen.getByRole("dialog"));
    });
  });

  describe("contacts", () => {
    const ann = { uuid: "ann", email: "ann@example.com", publicKey: "AAAA" };
    const bob = { uuid: "bob", email: "bob@example.com", publicKey: "BBBB" };

    it("lists them and fills in the email of the one I pick", async () => {
      shares.value = { ...base(), contacts: [ann, bob] };
      render(<ShareDialog />);
      expect(screen.getByRole("button", { name: "ann@example.com" })).toBeTruthy();

      await userEvent.click(screen.getByRole("button", { name: "bob@example.com" }));
      expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("bob@example.com");
    });

    it("lists them by nickname but still fills in the email", async () => {
      shares.value = { ...base(), contacts: [ann], nicknames: { ann: "Annie" } };
      render(<ShareDialog />);

      await userEvent.click(screen.getByRole("button", { name: "Annie (ann@example.com)" }));

      expect((screen.getByLabelText("Email address") as HTMLInputElement).value).toBe("ann@example.com");
    });

    it("leaves out the people who already have access", () => {
      const space = { id: "space", kind: "journal", scope: "collection", target: "folder-1", members: [{ ...ann, user: "ann", permission: "read", status: "accepted" }] };
      shares.value = { ...base(), owned: [space], contacts: [ann, bob] };
      render(<ShareDialog />);
      expect(screen.queryByRole("button", { name: "ann@example.com" })).toBeNull();
      expect(screen.getByRole("button", { name: "bob@example.com" })).toBeTruthy();
    });

    it("shows no list without contacts", () => {
      render(<ShareDialog />);
      expect(screen.queryByText("Contacts")).toBeNull();
    });
  });

  it("describes what can edit means for a single item", () => {
    shares.value = { ...base(), shareRequest: { ...request, scope: "item" } };
    render(<ShareDialog />);
    expect(screen.getByText(/open this item and see changes/)).toBeTruthy();
  });
});
