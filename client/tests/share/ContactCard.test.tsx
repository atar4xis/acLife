import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoViolations } from "../a11y/axe.ts";

const shares = vi.hoisted(() => ({
  nicknames: {} as Record<string, string>,
  setNickname: vi.fn(),
}));

vi.mock("../../src/context/ShareContext.tsx", () => ({
  useShares: () => shares,
}));

import ContactCard from "../../src/components/sharing/ContactCard.tsx";

const ann = { uuid: "ann", email: "ann@example.com", publicKey: "AAAA" };

beforeEach(() => {
  shares.nicknames = {};
  shares.setNickname.mockClear();
});

describe("ContactCard", () => {
  describe("mini", () => {
    it("shows just the email of someone without a nickname", () => {
      render(<ContactCard mini contact={ann} />);

      expect(screen.getByText("ann@example.com")).toBeTruthy();
    });

    it("shows the nickname with the email in brackets", () => {
      shares.nicknames = { ann: "Annie" };
      render(<ContactCard mini contact={ann} />);

      expect(screen.getByText("Annie")).toBeTruthy();
      expect(screen.getByText("(ann@example.com)")).toBeTruthy();
    });

    it("has no pencil and no security code", () => {
      render(<ContactCard mini contact={ann} />);

      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByText(/\d{5}/)).toBeNull();
    });
  });

  describe("full", () => {
    it("shows the name with a pencil and the security code", async () => {
      render(<ContactCard contact={ann} />);

      expect(screen.getByRole("button", { name: "Set a nickname for ann@example.com" })).toBeTruthy();
      expect(await screen.findByText(/^\d{5}( \d{5}){5}$/)).toBeTruthy();
    });

    it("shows the email under the nickname", () => {
      shares.nicknames = { ann: "Annie" };
      render(<ContactCard contact={ann} />);

      expect(screen.getByText("Annie")).toBeTruthy();
      expect(screen.getByText("ann@example.com")).toBeTruthy();
    });

    it("has room for an action and for more details", () => {
      render(
        <ContactCard contact={ann} action={<button>Remove</button>}>
          <p>Warning</p>
        </ContactCard>,
      );

      expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
      expect(screen.getByText("Warning")).toBeTruthy();
    });

    it("leaves the code out without a key", () => {
      render(<ContactCard contact={{ uuid: "ann", email: "ann@example.com" }} />);

      expect(screen.queryByText(/\d{5}/)).toBeNull();
    });

    it("renames in place and saves with Enter", async () => {
      render(<ContactCard contact={ann} />);
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Set a nickname for ann@example.com" }));
      await user.clear(screen.getByRole("textbox", { name: "Nickname" }));
      await user.type(screen.getByRole("textbox", { name: "Nickname" }), "Annie{Enter}");

      expect(shares.setNickname).toHaveBeenCalledWith("ann", "Annie");
    });

    it("has no accessibility violations", async () => {
      shares.nicknames = { ann: "Annie" };
      const { container } = render(
        <>
          <ContactCard contact={ann} />
          <ContactCard mini contact={ann} />
        </>,
      );

      await expectNoViolations(container);
    });
  });
});
