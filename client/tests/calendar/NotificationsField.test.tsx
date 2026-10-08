import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import NotificationsField, {
  AddNotificationButton,
} from "../../src/components/calendar/NotificationsField.tsx";
import type { EventNotification } from "../../src/types/calendar/Event.ts";

const push = vi.hoisted(() => ({
  subscription: "{}" as string | null,
  isTauri: false,
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => ({ get: () => push.subscription }),
}));

vi.mock("../../src/lib/nativeUpdater.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get isTauri() {
    return push.isTauri;
  },
}));

let latest: EventNotification[] = [];

function Harness({ initial = [] }: { initial?: EventNotification[] }) {
  const [value, setValue] = useState(initial);
  latest = value;
  return (
    <>
      <AddNotificationButton value={value} onChange={setValue} />
      <NotificationsField value={value} onChange={setValue} />
    </>
  );
}

const add = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Add notification" }));

describe("NotificationsField", () => {
  beforeEach(() => {
    push.subscription = "{}";
    push.isTauri = false;
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.scrollIntoView = () => {};
  });

  it("has no notifications until one is added", () => {
    render(<Harness />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(document.body.querySelector("div div")).toBeNull();
  });

  it("adds a notification that fires when the event starts, with a sound", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await add(user);

    expect(latest).toMatchObject([{ when: "start", method: "sound" }]);
    expect(screen.getByRole("combobox", { name: "When to notify" })).toHaveTextContent(
      "When the event starts",
    );
    expect(screen.getByRole("combobox", { name: "How to notify" })).toHaveTextContent(
      "Play a sound",
    );
  });

  it("only asks for an amount when it is before the event", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await add(user);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "When to notify" }));
    await user.click(
      await screen.findByRole("option", { name: "Hours before the event" }),
    );

    expect(latest[0].when).toBe("hours");
    const amount = screen.getByRole("spinbutton", { name: "Amount" });
    await user.clear(amount);
    await user.type(amount, "3");
    expect(latest[0].amount).toBe(3);
  });

  it("keeps the amount between 1 and 99", async () => {
    const user = userEvent.setup();
    render(
      <Harness initial={[{ when: "days", amount: 5, method: "sound" }]} />,
    );

    const amount = screen.getByRole("spinbutton", { name: "Amount" });
    await user.clear(amount);
    await user.type(amount, "500");
    expect(latest[0].amount).toBe(99);

    await user.clear(amount);
    await user.type(amount, "0");
    await user.tab();
    expect(latest[0].amount).toBe(1);
    expect(amount).toHaveValue(1);
  });

  it("picks how to notify", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ when: "start", amount: 10, method: "sound" }]} />);

    await user.click(screen.getByRole("combobox", { name: "How to notify" }));
    await user.click(
      await screen.findByRole("option", {
        name: "Send a push notification to all devices",
      }),
    );

    expect(latest[0].method).toBe("all");
  });

  it("only offers a sound while push is not enabled", async () => {
    const user = userEvent.setup();
    push.subscription = null;
    render(
      <Harness initial={[{ when: "start", amount: 10, method: "sound" }]} />,
    );

    await user.click(screen.getByRole("combobox", { name: "How to notify" }));

    expect(
      await screen.findByRole("option", { name: "Play a sound" }),
    ).not.toHaveAttribute("aria-disabled");
    for (const name of [
      "Send a push notification to this device",
      "Send a push notification to all devices",
    ]) {
      expect(screen.getByRole("option", { name })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
  });

  it("offers push without a subscription in the desktop app", async () => {
    const user = userEvent.setup();
    push.subscription = null;
    push.isTauri = true;
    render(
      <Harness initial={[{ when: "start", amount: 10, method: "sound" }]} />,
    );

    await user.click(screen.getByRole("combobox", { name: "How to notify" }));

    await screen.findByRole("option", { name: "Play a sound" });
    for (const name of [
      "Send a push notification to this device",
      "Send a push notification to all devices",
    ]) {
      expect(screen.getByRole("option", { name })).not.toHaveAttribute(
        "aria-disabled",
      );
    }
  });

  it("allows at most three notifications", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await add(user);
    await add(user);
    await add(user);

    expect(latest).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Add notification" }),
    ).not.toBeInTheDocument();
  });

  it("removes only the chosen notification", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={[
          { when: "minutes", amount: 5, method: "sound" },
          { when: "hours", amount: 2, method: "device" },
        ]}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: "Remove notification" })[0]);

    expect(latest).toEqual([{ when: "hours", amount: 2, method: "device" }]);
    expect(screen.getByRole("button", { name: "Add notification" })).toBeInTheDocument();
  });

  it("puts the amount before the unit, and the method on its own line", () => {
    render(<Harness initial={[{ when: "minutes", amount: 5, method: "sound" }]} />);

    const amount = screen.getByRole("spinbutton");
    const when = screen.getByRole("combobox", { name: "When to notify" });
    const how = screen.getByRole("combobox", { name: "How to notify" });

    expect(amount.compareDocumentPosition(when)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(amount.parentElement).toBe(when.parentElement);
    expect(how.parentElement).not.toBe(when.parentElement);
  });

  it("keeps each notification in its own card with its own remove button", () => {
    render(
      <Harness
        initial={[
          { when: "minutes", amount: 5, method: "sound" },
          { when: "hours", amount: 2, method: "sound" },
        ]}
      />,
    );

    const [first, second] = screen.getAllByRole("button", {
      name: "Remove notification",
    });

    expect(first.parentElement).not.toBe(second.parentElement);
    expect(
      first.parentElement?.contains(screen.getAllByRole("spinbutton")[0]),
    ).toBe(true);
    expect(
      first.parentElement?.contains(screen.getAllByRole("spinbutton")[1]),
    ).toBe(false);
  });
});
