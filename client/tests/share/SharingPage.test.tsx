import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoViolations } from "../a11y/axe.ts";
import { readSettings } from "../settingsStorage";

const shares = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const extraItems = vi.hoisted(() => ({ value: [] as [string, unknown][] }));

vi.mock("../../src/context/ShareContext.tsx", () => ({
  useShares: () => shares.value,
}));
vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({ user: { type: "online", uuid: "me" } }),
}));
vi.mock("../../src/context/JournalContext.tsx", () => ({
  useJournal: () => ({
    itemsById: new Map([
      ["folder-1", { id: "folder-1", type: "folder", name: "Recipes" }],
      ["note-1", { id: "note-1", type: "note", name: "Pasta" }],
      ["red-1", { id: "red-1", type: "note", name: "Urgent", color: "rgb(255, 0, 0)", colorIcon: true }],
      ...extraItems.value,
    ]),
  }),
}));
vi.mock("../../src/context/CalendarContext.tsx", () => ({
  useEventList: () => [{ id: "evt", title: "Dinner" }],
}));

import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import SharingPage from "../../src/components/settings/pages/SharingPage.tsx";

const owned = (extra: Record<string, unknown> = {}) => ({
  id: "o1",
  kind: "journal",
  scope: "collection",
  target: "folder-1",
  members: [
    { user: "ann", email: "ann@example.com", publicKey: "AAAA", permission: "read", status: "accepted" },
  ],
  ...extra,
});

const base = () => ({
  enabled: true,
  owned: [] as unknown[],
  joined: [] as unknown[],
  invites: [] as unknown[],
  contacts: [] as unknown[],
  nameOf: (uuid: string, email: string) =>
    (shares.value.nicknames as Record<string, string> | undefined)?.[uuid] ?? email,
  nicknames: {} as Record<string, string>,
  setNickname: vi.fn(),
  publicKey: "AAAA",
  openShare: vi.fn(),
  removeMember: vi.fn().mockResolvedValue(true),
  deleteSpace: vi.fn().mockResolvedValue(true),
  setPermission: vi.fn().mockResolvedValue(true),
  respondToInvite: vi.fn().mockResolvedValue(true),
  trustOf: vi.fn().mockReturnValue("same"),
  pinContact: vi.fn(),
  removeContact: vi.fn(),
});

const renderPage = () =>
  render(
    <SettingsStoreProvider>
      <SharingPage sectionRefs={{ current: new Map() }} />
    </SettingsStoreProvider>,
  );

beforeEach(() => {
  extraItems.value = [];
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.releasePointerCapture = () => {};
  shares.value = base();
});

describe("SharingPage", () => {
  it("explains when sharing is not available", () => {
    shares.value = { ...base(), enabled: false };
    renderPage();
    expect(screen.getByText(/To use sharing/)).toBeTruthy();
  });

  it("starts a share of the whole calendar or journal", async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Share your whole calendar" }));
    await user.click(screen.getByRole("button", { name: "Share your whole journal" }));

    const open = shares.value.openShare as ReturnType<typeof vi.fn>;
    expect(open.mock.calls[0][0]).toMatchObject({ kind: "calendar", scope: "collection", target: null });
    expect(open.mock.calls[1][0]).toMatchObject({ kind: "journal", scope: "collection", target: null });
  });

  it("shows my own security code", async () => {
    renderPage();
    expect(await screen.findByText(/^(\d{5} ){5}\d{5}$/, { selector: "span" })).toBeTruthy();
  });

  describe("invitations", () => {
    it("stays visible without invitations", () => {
      renderPage();
      expect(screen.getByText("No invitations.")).toBeTruthy();
      expect(screen.getByRole("switch", { name: "Invitation notifications" })).toBeTruthy();
    });

    it("switches the notification off and on", async () => {
      renderPage();
      const toggle = screen.getByRole("switch", { name: "Invitation notifications" });
      expect(toggle.getAttribute("aria-checked")).toBe("true");

      await userEvent.click(toggle);
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      expect(readSettings().inviteNotifications).toBe(false);
    });
  });

  describe("shared by me", () => {
    beforeEach(() => {
      shares.value = { ...base(), owned: [owned()] };
    });

    it("names the shared folder and its people", () => {
      renderPage();
      expect(screen.getByText("Recipes")).toBeTruthy();
      expect(screen.getAllByText("ann@example.com").length).toBeGreaterThan(0);
    });

    describe("icons", () => {
      const iconOf = (container: HTMLElement) => container.querySelector("li svg.lucide-folder, li svg.lucide-file-text, li svg.lucide-book-text, li svg.lucide-calendar-days, li svg.lucide-calendar-clock")?.getAttribute("class");

      const render1 = (space: Record<string, unknown>) => {
        shares.value = { ...base(), owned: [owned({ members: [], ...space })] };
        return renderPage();
      };

      it("shows the journal for the whole journal", () => {
        const { container } = render1({ kind: "journal", scope: "collection", target: null });
        expect(iconOf(container)).toContain("lucide-book-text");
      });

      it("shows the folder icon for a folder", () => {
        const { container } = render1({ kind: "journal", scope: "collection", target: "folder-1" });
        expect(iconOf(container)).toContain("lucide-folder");
      });

      it("shows the note icon for a note", () => {
        const { container } = render1({ kind: "journal", scope: "item", target: "note-1" });
        expect(iconOf(container)).toContain("lucide-file-text");
      });

      it("keeps the colour the note has in the journal", () => {
        const { container } = render1({ kind: "journal", scope: "item", target: "red-1" });

        expect((container.querySelector("svg.lucide-file-text") as SVGElement).style.color).toBe("rgb(255, 0, 0)");
      });

      it("falls back to a note or folder icon when the item is gone", () => {
        expect(iconOf(render1({ kind: "journal", scope: "item", target: "gone" }).container)).toContain("lucide-file-text");
        cleanup();
        expect(iconOf(render1({ kind: "journal", scope: "collection", target: "gone" }).container)).toContain("lucide-folder");
      });

      it("shows the calendar for the whole calendar and a clock for an event", () => {
        expect(iconOf(render1({ kind: "calendar", scope: "collection", target: null }).container)).toContain("lucide-calendar-days");
        cleanup();
        expect(iconOf(render1({ kind: "calendar", scope: "item", target: "evt" }).container)).toContain("lucide-calendar-clock");
      });
    });

    it("names an event by its title", () => {
      shares.value = {
        ...base(),
        owned: [owned({ kind: "calendar", scope: "item", target: "evt", members: [] })],
      };
      renderPage();
      expect(screen.getByText("Dinner")).toBeTruthy();
    });

    it("names the whole journal and calendar", () => {
      shares.value = {
        ...base(),
        owned: [
          owned({ id: "a", target: null, members: [] }),
          owned({ id: "b", kind: "calendar", target: null, members: [] }),
        ],
      };
      renderPage();
      expect(screen.getAllByText("Whole journal").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Whole calendar").length).toBeGreaterThan(0);
    });

    it("opens the dialog of a space to share it further", async () => {
      renderPage();
      await userEvent.click(screen.getByRole("button", { name: "Share" }));
      expect(shares.value.openShare).toHaveBeenCalledWith({
        kind: "journal",
        scope: "collection",
        target: "folder-1",
        label: "Recipes",
      });
    });

    it("changes the permission of a person and removes them", async () => {
      renderPage();
      const user = userEvent.setup();
      await user.click(screen.getByRole("combobox", { name: "Permission for ann@example.com" }));
      await user.click(await screen.findByRole("option", { name: "Can edit" }));
      expect(shares.value.setPermission).toHaveBeenCalledWith("o1", "ann", "write");

      await user.click(screen.getByRole("button", { name: "Remove ann@example.com" }));
      expect(shares.value.removeMember).toHaveBeenCalledWith("o1", "ann");
    });

    it("stops sharing the whole space", async () => {
      renderPage();
      await userEvent.setup().click(screen.getByRole("button", { name: "Stop sharing" }));

      expect(shares.value.deleteSpace).toHaveBeenCalledWith("o1");
    });
  });

  describe("shared with me", () => {
    const joined = {
      id: "j1",
      owner: "bob",
      ownerEmail: "bob@example.com",
      ownerPublicKey: "BBBB",
      kind: "calendar",
      scope: "collection",
      permission: "read",
    };

    it("shows an icon by what was shared with me", () => {
      shares.value = {
        ...base(),
        joined: [
          { ...joined, id: "j1", kind: "calendar", scope: "collection" },
          { ...joined, id: "j2", kind: "calendar", scope: "item" },
          { ...joined, id: "j3", kind: "journal", scope: "collection" },
          { ...joined, id: "j4", kind: "journal", scope: "item" },
        ],
      };
      const { container } = renderPage();
      const cards = Array.from(container.querySelectorAll("li")).filter((li) => li.textContent?.includes("bob@example.com"));
      const iconOf = (li: Element) => li.querySelector("svg.lucide-calendar-days, svg.lucide-calendar-clock, svg.lucide-book-text, svg.lucide-file-text, svg.lucide-folder")?.getAttribute("class");

      expect(cards).toHaveLength(4);
      expect(iconOf(cards[0])).toContain("lucide-calendar-days");
      expect(iconOf(cards[1])).toContain("lucide-calendar-clock");
      expect(iconOf(cards[2])).toContain("lucide-book-text");
      expect(iconOf(cards[3])).toContain("lucide-file-text");
      expect(cards[2].textContent).toContain("Whole journal");
      expect(cards[3].textContent).toContain("Note");
    });

    it("names a shared note after the note and uses its icon", () => {
      shares.value = {
        ...base(),
        joined: [{ ...joined, kind: "journal", scope: "item" }],
      };
      extraItems.value = [["n", { id: "n", type: "note", name: "Pasta joined", parentId: null, _shared: { space: "j1" } }]];
      const { container } = renderPage();

      expect(screen.getByText("Pasta joined")).toBeTruthy();
      expect(container.querySelector("li svg.lucide-file-text")).toBeTruthy();
    });

    it("lists what others share and lets me leave", async () => {
      shares.value = { ...base(), joined: [joined] };
      renderPage();

      expect(screen.getAllByText("bob@example.com").length).toBeGreaterThan(0);
      expect(screen.getByText("Whole calendar")).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Leave" }));
      expect(shares.value.removeMember).toHaveBeenCalledWith("j1", "me");
    });
  });

  describe("invitations", () => {
    const invite = {
      id: "i1",
      owner: "bob",
      ownerEmail: "bob@example.com",
      ownerPublicKey: "BBBB",
      kind: "journal",
      scope: "item",
      permission: "write",
      status: "pending",
    };

    beforeEach(() => {
      shares.value = { ...base(), invites: [invite] };
    });

    it("shows an icon for what was shared", () => {
      shares.value = {
        ...base(),
        invites: [
          { ...invite, id: "a", kind: "calendar", scope: "item" },
          { ...invite, id: "b", kind: "journal", scope: "collection" },
        ],
      };
      renderPage();

      const icons = screen.getAllByText(/shared .* with you/).map((m) => m.closest("li")!.querySelector("svg")?.getAttribute("class"));
      expect(icons[0]).toContain("lucide-calendar-clock");
      expect(icons[1]).toContain("lucide-folder");
    });

    it("shows the message with the permission as small muted text after it", () => {
      renderPage();

      const message = screen.getByText(/bob@example.com shared a note with you\./);
      const permission = within(message).getByText("(can edit)");

      expect(message.textContent).toBe("bob@example.com shared a note with you. (can edit)");
      expect(permission.className).toContain("text-muted-foreground");
      expect(permission.className).toContain("text-xs");
    });

    it("keeps each invitation in its own card", () => {
      shares.value = { ...base(), invites: [invite, { ...invite, id: "i2" }] };
      renderPage();

      const cards = screen.getAllByText(/shared a note with you/).map((m) => m.closest("li"));
      expect(cards).toHaveLength(2);
      expect(cards[0]).not.toBe(cards[1]);
      expect(cards[0]!.className).toContain("border");
    });

    it("accepts at once from someone whose code I know", async () => {
      renderPage();
      await userEvent.click(screen.getByRole("button", { name: "Accept" }));

      await waitFor(() => expect(shares.value.respondToInvite).toHaveBeenCalledWith("i1", true));
      expect(shares.value.pinContact).toHaveBeenCalled();
    });

    it("pins their code before it accepts", async () => {
      const order: string[] = [];
      (shares.value.pinContact as ReturnType<typeof vi.fn>).mockImplementation(() => order.push("pin"));
      (shares.value.respondToInvite as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push("respond");
        return true;
      });
      renderPage();
      await userEvent.click(screen.getByRole("button", { name: "Accept" }));

      await waitFor(() => expect(order).toEqual(["pin", "respond"]));
    });

    it("shows the code of someone new before accepting", async () => {
      (shares.value.trustOf as ReturnType<typeof vi.fn>).mockReturnValue("new");
      renderPage();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Accept" }));

      const dialog = await screen.findByRole("dialog", { name: "Accept this invitation?" });
      expect(shares.value.respondToInvite).not.toHaveBeenCalled();
      await expectNoViolations(dialog);

      await user.click(within(dialog).getByRole("button", { name: "Accept" }));
      await waitFor(() => expect(shares.value.respondToInvite).toHaveBeenCalledWith("i1", true));
    });

    it("keeps the invitation when cancelling at the code", async () => {
      (shares.value.trustOf as ReturnType<typeof vi.fn>).mockReturnValue("changed");
      renderPage();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Accept" }));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/security code for bob@example.com has changed/)).toBeTruthy();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(shares.value.respondToInvite).not.toHaveBeenCalled();
      expect(shares.value.pinContact).not.toHaveBeenCalled();
    });

    it("declines", async () => {
      renderPage();
      await userEvent.click(screen.getByRole("button", { name: "Decline" }));
      expect(shares.value.respondToInvite).toHaveBeenCalledWith("i1", false);
    });
  });

  describe("contacts", () => {
    it("warns when the code of someone changed and lets me trust the new one", async () => {
      shares.value = {
        ...base(),
        contacts: [{ uuid: "ann", email: "ann@example.com", publicKey: "AAAA" }],
        trustOf: vi.fn().mockReturnValue("changed"),
      };
      renderPage();

      expect(screen.getByText(/security code for ann@example.com has changed/)).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Trust new security code" }));
      expect(shares.value.pinContact).toHaveBeenCalledWith({
        uuid: "ann",
        email: "ann@example.com",
        publicKey: "AAAA",
      });
    });

    it("lists my contacts", () => {
      shares.value = {
        ...base(),
        contacts: [{ uuid: "ann", email: "ann@example.com", publicKey: "AAAA" }],
      };
      renderPage();
      expect(screen.getByText("ann@example.com")).toBeTruthy();
    });

    it("uses the nickname for the people in shares and invitations", () => {
      shares.value = {
        ...base(),
        nicknames: { ann: "Annie", bob: "Bobby" },
        owned: [owned()],
        joined: [{ id: "j1", owner: "bob", ownerEmail: "bob@example.com", kind: "calendar", scope: "collection", permission: "read" }],
        invites: [{ id: "i1", owner: "bob", ownerEmail: "bob@example.com", ownerPublicKey: "BBBB", kind: "journal", scope: "item", permission: "write", status: "pending" }],
      };
      renderPage();

      expect(screen.getByText("Annie")).toBeTruthy();
      expect(screen.getByText("(ann@example.com)")).toBeTruthy();
      expect(screen.getByText("Bobby")).toBeTruthy();
      expect(screen.getByText("(bob@example.com)")).toBeTruthy();
      expect(screen.getByText(/Bobby shared/)).toBeTruthy();
    });

    it("shows the nickname with the email below it", () => {
      shares.value = {
        ...base(),
        contacts: [{ uuid: "ann", email: "ann@example.com", publicKey: "AAAA" }],
        nicknames: { ann: "Annie" },
      };
      renderPage();

      expect(screen.getByText("Annie")).toBeTruthy();
      expect(screen.getByText("ann@example.com")).toBeTruthy();
    });

    it("sets a nickname with the pencil", async () => {
      shares.value = {
        ...base(),
        contacts: [{ uuid: "ann", email: "ann@example.com", publicKey: "AAAA" }],
      };
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Set a nickname for ann@example.com" }));
      await user.clear(screen.getByRole("textbox", { name: "Nickname" }));
      await user.type(screen.getByRole("textbox", { name: "Nickname" }), "Annie{Enter}");

      expect(shares.value.setNickname).toHaveBeenCalledWith("ann", "Annie");
      expect(screen.queryByRole("textbox", { name: "Nickname" })).toBeNull();
    });

    it("starts from the current name and changes nothing when left as it was", async () => {
      shares.value = {
        ...base(),
        contacts: [{ uuid: "ann", email: "ann@example.com", publicKey: "AAAA" }],
      };
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Set a nickname for ann@example.com" }));
      expect((screen.getByRole("textbox", { name: "Nickname" }) as HTMLInputElement).value).toBe("ann@example.com");
      await user.keyboard("{Enter}");

      expect(shares.value.setNickname).not.toHaveBeenCalled();
      expect(screen.getByText("ann@example.com")).toBeTruthy();
    });

    it("drops the edit on Escape", async () => {
      shares.value = {
        ...base(),
        contacts: [{ uuid: "ann", email: "ann@example.com", publicKey: "AAAA" }],
      };
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Set a nickname for ann@example.com" }));
      await user.type(screen.getByRole("textbox", { name: "Nickname" }), "x{Escape}");

      expect(shares.value.setNickname).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox", { name: "Nickname" })).toBeNull();
    });

    it("removes the nickname when the email is typed back", async () => {
      shares.value = {
        ...base(),
        contacts: [{ uuid: "ann", email: "ann@example.com", publicKey: "AAAA" }],
        nicknames: { ann: "Annie" },
      };
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Set a nickname for ann@example.com" }));
      await user.clear(screen.getByRole("textbox", { name: "Nickname" }));
      await user.type(screen.getByRole("textbox", { name: "Nickname" }), "ann@example.com{Enter}");

      expect(shares.value.setNickname).toHaveBeenCalledWith("ann", "");
    });

    it("clears the nickname when the field is emptied", async () => {
      shares.value = {
        ...base(),
        contacts: [{ uuid: "ann", email: "ann@example.com", publicKey: "AAAA" }],
        nicknames: { ann: "Annie" },
      };
      renderPage();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Set a nickname for ann@example.com" }));
      await user.clear(screen.getByRole("textbox", { name: "Nickname" }));
      await user.tab();

      expect(shares.value.setNickname).toHaveBeenCalledWith("ann", "");
    });

    it("removes a contact that no share needs", async () => {
      shares.value = {
        ...base(),
        contacts: [{ uuid: "ann", email: "ann@example.com", publicKey: "AAAA", removable: true }],
      };
      renderPage();
      await userEvent.click(screen.getByRole("button", { name: "Remove contact ann@example.com" }));
      expect(shares.value.removeContact).toHaveBeenCalledWith("ann");
    });

    it("keeps contacts that a share still involves", () => {
      shares.value = {
        ...base(),
        contacts: [{ uuid: "ann", email: "ann@example.com", publicKey: "AAAA", removable: false }],
      };
      renderPage();
      expect(screen.getByText("ann@example.com")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Remove contact/ })).toBeNull();
    });

    it("adds a contact from the plus button", async () => {
      shares.value = {
        ...base(),
        lookupContact: vi.fn().mockResolvedValue({ uuid: "dan", email: "dan@example.com", publicKey: "DDDD" }),
        trustOf: vi.fn().mockReturnValue("same"),
      };
      renderPage();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Add contact" }));
      await user.type(screen.getByLabelText("Email address"), "dan@example.com");
      await user.click(screen.getByRole("button", { name: "Continue" }));

      await waitFor(() =>
        expect(shares.value.pinContact).toHaveBeenCalledWith({ uuid: "dan", email: "dan@example.com", publicKey: "DDDD" }),
      );
    });
  });

  it("has no accessibility violations", async () => {
    shares.value = {
      ...base(),
      owned: [owned()],
      invites: [],
    };
    const { container } = renderPage();
    await expectNoViolations(container);
  });
});
