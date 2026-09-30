import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { expectNoViolations } from "./axe.ts";
import {
  FIXED_NOW,
  advanceSave,
  getLastSavedEvents,
  getSelectionBox,
  moveSelectionBox,
  startSelectionBox,
  buildEvent,
  buildPlainEvent,
  getEventBlock,
  openEventEditor,
  renderCalendar,
  setupCalendarTests,
} from "../calendar/helpers.tsx";
import { seedSettings } from "../settingsStorage.ts";

setupCalendarTests();

const day = FIXED_NOW.startOf("day");

const events = () => [
  buildPlainEvent(),
  buildEvent({
    id: "task",
    title: "Pay rent",
    isTask: true,
    start: day.plus({ hours: 12 }),
    end: day.plus({ hours: 13 }),
  }),
  buildEvent({
    id: "overlap",
    title: "Overlap",
    start: day.plus({ hours: 9, minutes: 30 }),
    end: day.plus({ hours: 10, minutes: 30 }),
  }),
  buildEvent({
    id: "trip",
    title: "Trip",
    start: day.plus({ hours: 22 }),
    end: day.plus({ days: 1, hours: 2 }),
  }),
];

describe("Calendar grid a11y", () => {
  it.each([
    ["day", "top", "left"],
    ["day", "bottom", "right"],
    ["week", "top", "left"],
    ["week", "bottom", "right"],
  ] as const)(
    "has no axe violations in %s view, header %s, labels %s",
    async (mode, dayHeaderPosition, timeLabelPosition) => {
      seedSettings({ dayHeaderPosition, timeLabelPosition });
      const { container } = renderCalendar({ mode, events: events() });
      await screen.findByText("Planning");

      await expectNoViolations(container);
    },
  );

  it("exposes grid, column headers, gridcells and named events", async () => {
    renderCalendar({ mode: "week", events: events() });
    await screen.findByText("Planning");

    expect(screen.getByRole("grid", { name: "Calendar" })).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", {
        name: "Wednesday 18 March 2026, today",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Thursday 19 March 2026" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("gridcell").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", {
        name: "Planning, Wednesday 18 March, 9 to 10 AM",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: "Pay rent, Wednesday 18 March, 12 to 1 PM, task, not completed",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Pay rent completed" }),
    ).toBeInTheDocument();
  });

  it("describes multi-day events and their continuation", async () => {
    renderCalendar({ mode: "week", events: events() });
    await screen.findByText("Planning");

    const label = "Trip, Wednesday 18 March 10 PM to Thursday 19 March 2 AM";
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `${label}, continued from previous day`,
      }),
    ).toBeInTheDocument();
  });

  it("marks selected and repeating events in the name", async () => {
    const { user } = renderCalendar({
      events: [buildEvent({ repeat: { interval: 1, unit: "day" as const } })],
    });
    const block = await getEventBlock("Planning");
    expect(block).toHaveAccessibleName(
      "Planning, Wednesday 18 March, 9 to 10 AM, repeating",
    );

    await user.keyboard("{Control>}");
    await user.click(block);
    await user.keyboard("{/Control}");
    expect(block).toHaveAccessibleName(/, repeating, selected$/);
  });

  it("hides the current time line from assistive tech", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");

    const line = document.querySelector(".bg-foreground.shadow-xl");
    expect(line).toHaveAttribute("aria-hidden", "true");
  });

  it("has no axe violations with the event editor open", async () => {
    const { user } = renderCalendar({ events: [buildPlainEvent()] });
    await openEventEditor(user, "Planning");

    // the editor is not a dialog or landmark, so axe reports it as outside any region
    await expectNoViolations(document.body, ["region"]);
  });

  it("names time zone column headers when there are several", async () => {
    seedSettings({ timezones: ["UTC", "Asia/Tokyo"], defaultTimezone: "UTC" });
    renderCalendar();
    await screen.findByText("Wed 18");

    expect(
      screen.getByRole("columnheader", { name: "Asia/Tokyo" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("rowheader")).toHaveLength(48);
  });

  it("has one time label row header per hour", async () => {
    renderCalendar();
    await screen.findByText("Wed 18");

    expect(screen.getAllByRole("rowheader")).toHaveLength(24);
    expect(screen.getAllByRole("row")).toHaveLength(25);
  });

  it("names events crossing noon and completed tasks", async () => {
    renderCalendar({
      events: [
        buildEvent({
          id: "long",
          title: "Workshop",
          start: day.plus({ hours: 11 }),
          end: day.plus({ hours: 13, minutes: 30 }),
          isTask: true,
          completed: true,
        }),
      ],
    });

    expect(
      await screen.findByRole("group", {
        name: "Workshop, Wednesday 18 March, 11 AM to 1:30 PM, task, completed",
      }),
    ).toBeInTheDocument();
  });

  it("exposes task blocks as groups with a named checkbox that stays out of the tab order", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({ events: events(), saveEvents });

    const group = await screen.findByRole("group", {
      name: /^Pay rent, .*task, not completed$/,
    });
    const checkbox = within(group).getByRole("checkbox", {
      name: "Pay rent completed",
    });
    expect(checkbox).toHaveAttribute("tabindex", "-1");
    expect(group).toHaveAttribute("aria-keyshortcuts", "M Control+Enter");

    await user.click(checkbox);
    await advanceSave();

    expect(
      getLastSavedEvents(saveEvents).find((e) => e.id === "task"),
    ).toMatchObject({
      completed: true,
    });
  });

  it("keeps plain events as buttons", async () => {
    renderCalendar({ events: events() });

    const button = await screen.findByRole("button", { name: /^Planning, / });
    expect(button).toHaveAttribute("data-event-key");
    expect(screen.queryByRole("group", { name: /^Planning, / })).toBeNull();
  });

  it("hides the selection box from assistive tech", async () => {
    renderCalendar({ events: events() });
    await screen.findByText("Planning");

    startSelectionBox({ x: 100, y: 100 });
    moveSelectionBox({ x: 150, y: 200 });

    expect(getSelectionBox()).toHaveAttribute("aria-hidden", "true");
  });

  it("names the repeat unit select for custom repeats", async () => {
    const { user } = renderCalendar({
      events: [buildEvent({ repeat: { interval: 2, unit: "week" as const } })],
    });
    await openEventEditor(user, "Planning");

    expect(
      screen.getByRole("combobox", { name: "Repeat unit" }),
    ).toBeInTheDocument();
  });
});
