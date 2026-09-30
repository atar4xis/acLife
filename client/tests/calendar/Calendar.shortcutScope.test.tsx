import { describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import {
  buildPlainEvent,
  ctrlClickEvent,
  getEventBlock,
  isSelected,
  renderCalendar,
  setupCalendarTests,
} from "./helpers";
import { shortcutsApply } from "../../src/lib/calendar/shortcutScope.ts";

setupCalendarTests();

const addFocusable = (
  parent: Element,
  tag: string,
  attrs: Record<string, string> = {},
) => {
  const el = document.createElement(tag);
  el.tabIndex = 0;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.appendChild(el);
  el.focus();
  return el;
};

const main = () => document.querySelector("main")!;
const grid = () => screen.getByRole("grid");

const expectMoves = async (from: Element | Window) => {
  await screen.findByText("Wed 18");
  fireEvent.keyDown(from, { key: "ArrowRight" });
  expect(await screen.findByText("Thu 19")).toBeInTheDocument();
};

const expectStays = async (from: Element | Window) => {
  await screen.findByText("Wed 18");
  fireEvent.keyDown(from, { key: "ArrowRight" });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(screen.getByText("Wed 18")).toBeInTheDocument();
  expect(screen.queryByText("Thu 19")).not.toBeInTheDocument();
};

describe("Calendar shortcut scope", () => {
  it("changes date from the grid", async () => {
    renderCalendar();
    await expectMoves(grid());
  });

  it("changes date from an event block", async () => {
    renderCalendar({ events: [buildPlainEvent()] });
    await expectMoves(await getEventBlock("Planning"));
  });

  it("changes date from body", async () => {
    renderCalendar();
    await expectMoves(document.body);
  });

  it("changes date from the window", async () => {
    renderCalendar();
    await expectMoves(window);
  });

  it("changes date from a toolbar button", async () => {
    renderCalendar();
    await expectMoves(screen.getByTestId("next-btn"));
  });

  it("changes date after clicking the empty page background", async () => {
    const { user } = renderCalendar();
    await screen.findByText("Wed 18");
    await user.click(document.body);
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByText("Thu 19")).toBeInTheDocument();
  });

  it.each([
    ["slider", "div", { role: "slider" }],
    ["radio", "div", { role: "radio" }],
    ["select", "select", {}],
    ["combobox", "button", { role: "combobox" }],
    ["menu item", "div", { role: "menuitem" }],
    ["dialog content", "button", { "data-in": "dialog" }],
  ] as const)(
    "ignores keys while a %s outside the calendar has focus",
    async (_n, tag, attrs) => {
      renderCalendar();
      await screen.findByText("Wed 18");
      const host = document.createElement("div");
      if ("data-in" in attrs) host.setAttribute("role", "dialog");
      document.body.appendChild(host);

      await expectStays(addFocusable(host, tag, attrs));
    },
  );

  it.each([
    ["slider", "div", { role: "slider" }],
    ["radio", "div", { role: "radio" }],
    ["select", "select", {}],
    ["menu item", "div", { role: "menuitem" }],
    ["menu", "div", { role: "menu" }],
    ["combobox", "div", { role: "combobox" }],
    ["alert dialog", "div", { role: "alertdialog" }],
    ["editable text", "div", { contenteditable: "true" }],
    ["input", "input", {}],
    ["textarea", "textarea", {}],
  ] as const)(
    "ignores keys while a %s inside the calendar has focus",
    async (_n, tag, attrs) => {
      renderCalendar();
      await screen.findByText("Wed 18");

      await expectStays(addFocusable(main(), tag, attrs));
    },
  );

  it("ignores keys inside a dialog or popover rendered in the calendar", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");
    const dialog = addFocusable(main(), "div", { role: "dialog" });
    await expectStays(addFocusable(dialog, "button"));

    const popover = document.createElement("div");
    popover.setAttribute("data-radix-popper-content-wrapper", "");
    main().appendChild(popover);
    await expectStays(addFocusable(popover, "button"));
  });

  it("does not delete, undo or copy selection from a slider", async () => {
    renderCalendar({ events: [buildPlainEvent()] });
    await ctrlClickEvent("Planning");
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);

    const slider = addFocusable(document.body, "div", { role: "slider" });
    fireEvent.keyDown(slider, { key: "Escape" });
    fireEvent.keyDown(slider, { key: "Delete" });
    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(isSelected(await getEventBlock("Planning"))).toBe(true);
  });

  it("deletes the selection from the grid and from body", async () => {
    renderCalendar({ events: [buildPlainEvent()] });
    await ctrlClickEvent("Planning");

    fireEvent.keyDown(grid(), { key: "Delete" });
    expect(screen.queryByText("Planning")).not.toBeInTheDocument();
  });

  it("undoes from body but not from a menu outside the calendar", async () => {
    renderCalendar({ events: [buildPlainEvent()] });
    await ctrlClickEvent("Planning");
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(screen.queryByText("Planning")).not.toBeInTheDocument();

    const menu = addFocusable(document.body, "div", { role: "menuitem" });
    fireEvent.keyDown(menu, { key: "z", ctrlKey: true });
    expect(screen.queryByText("Planning")).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(await screen.findByText("Planning")).toBeInTheDocument();
  });
});

describe("shortcutsApply", () => {
  const plain = document.createElement("div");

  it("allows non-element targets, body, html and plain elements", () => {
    expect(shortcutsApply(window)).toBe(true);
    expect(shortcutsApply(document)).toBe(true);
    expect(shortcutsApply(null)).toBe(true);
    expect(shortcutsApply(document.body)).toBe(true);
    expect(shortcutsApply(document.documentElement)).toBe(true);
    expect(shortcutsApply(plain)).toBe(true);
    expect(
      shortcutsApply(plain.appendChild(document.createElement("button"))),
    ).toBe(true);
  });

  it("rejects controls that own the keys, and their descendants", () => {
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    const child = slider.appendChild(document.createElement("span"));
    expect(shortcutsApply(slider)).toBe(false);
    expect(shortcutsApply(child)).toBe(false);
    expect(shortcutsApply(document.createElement("input"))).toBe(false);
  });

  it.each([
    "dialog",
    "alertdialog",
    "slider",
    "radio",
    "radiogroup",
    "combobox",
    "listbox",
    "option",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "tab",
    "tablist",
    "spinbutton",
    "textbox",
    "searchbox",
    "tree",
    "treeitem",
  ])("rejects role %s", (role) => {
    const el = document.createElement("div");
    el.setAttribute("role", role);
    expect(shortcutsApply(el)).toBe(false);
  });

  it.each(["input", "textarea", "select"])("rejects a %s element", (tag) => {
    expect(shortcutsApply(document.createElement(tag))).toBe(false);
  });

  it("rejects popper content and contenteditable, allows contenteditable=false", () => {
    const popper = document.createElement("div");
    popper.setAttribute("data-radix-popper-content-wrapper", "");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const notEditable = document.createElement("div");
    notEditable.setAttribute("contenteditable", "false");
    expect(shortcutsApply(popper)).toBe(false);
    expect(shortcutsApply(editable)).toBe(false);
    expect(shortcutsApply(notEditable)).toBe(true);
  });
});
