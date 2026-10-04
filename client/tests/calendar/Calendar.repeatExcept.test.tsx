import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { toast } from "sonner";
import {
  FIXED_NOW,
  advanceSave,
  buildEvent,
  getLastSavedEvents,
  openEventEditor,
  renderCalendar,
  setupCalendarTests,
} from "./helpers";
import { seedSettings } from "../settingsStorage.ts";

setupCalendarTests();

const save = async (user: ReturnType<typeof renderCalendar>["user"]) => {
  await user.click(screen.getByRole("button", { name: /^save$/i }));
  await advanceSave();
};

describe("Calendar repeat exclusions", () => {
  it("rejects saving a repeat that excludes every day", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [
        buildEvent({
          repeat: { interval: 1, unit: "day", except: [1, 2, 3, 4, 5, 6, 7] },
        }),
      ],
      saveEvents,
    });

    await openEventEditor(user, "Planning");
    await advanceSave();
    saveEvents.mockClear();

    await save(user);

    expect(toast.warning).toHaveBeenCalledWith(
      "You cannot exclude every day from the repeat schedule.",
      expect.anything(),
    );
    expect(saveEvents).not.toHaveBeenCalled();
  });

  it("moves the series start off an excluded day when saving", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [
        buildEvent({
          repeat: {
            interval: 1,
            unit: "day",
            except: [FIXED_NOW.weekday],
          },
        }),
      ],
      saveEvents,
    });

    await openEventEditor(user, "Planning");
    await advanceSave();
    saveEvents.mockClear();

    await save(user);
    await user.click(screen.getByRole("radio", { name: /all events/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    const saved = getLastSavedEvents(saveEvents).find(
      (e) => e.id === "plain-event",
    );
    expect(saved?.start.toISODate()).toBe(
      FIXED_NOW.plus({ days: 1 }).toISODate(),
    );
    expect(saved?.end.toISODate()).toBe(FIXED_NOW.plus({ days: 1 }).toISODate());
  });
});

describe("Calendar custom repeat dialog", () => {
  it("applies an every-N-weeks repeat ending after a count", async () => {
    const saveEvents = vi.fn();
    const { user } = renderCalendar({
      events: [buildEvent({ repeat: { interval: 1, unit: "day" } })],
      saveEvents,
    });

    await openEventEditor(user, "Planning");
    await user.click(screen.getByRole("combobox", { name: "Repeat" }));
    await user.click(screen.getByRole("option", { name: "Custom repeat" }));

    const every = await screen.findByRole("spinbutton", { name: "Repeat every" });
    await user.clear(every);
    await user.type(every, "2");
    await user.click(screen.getByRole("combobox", { name: "Repeat interval unit" }));
    await user.click(screen.getByRole("option", { name: "Weeks" }));
    await user.click(screen.getByRole("checkbox", { name: "Forever" }));
    await user.click(screen.getByRole("combobox", { name: "Ends" }));
    await user.click(screen.getByRole("option", { name: "Ends after" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await save(user);
    await user.click(screen.getByRole("radio", { name: /all events/i }));
    await user.click(screen.getByRole("button", { name: /^update$/i }));
    await advanceSave();

    const [saved] = getLastSavedEvents(saveEvents);
    expect(saved.repeat).toMatchObject({
      interval: 2,
      unit: "week",
      days: [FIXED_NOW.weekday],
      count: 10,
    });
  });

  it("shows a legacy monthly repeat as the monthly-on-date preset", async () => {
    const { user } = renderCalendar({
      events: [buildEvent({ repeat: { interval: 1, unit: "month" } })],
    });

    await openEventEditor(user, "Planning");

    expect(screen.getByRole("combobox", { name: "Repeat" })).toHaveTextContent(
      /Repeat monthly on the \d+(st|nd|rd|th)$/,
    );
    expect(screen.queryByRole("button", { name: "Edit custom repeat" })).toBeNull();
  });

  it("orders the weekday toggles by the week start setting", async () => {
    seedSettings({ weekStartsOn: 7 });
    const { user } = renderCalendar({
      events: [buildEvent({ repeat: { interval: 2, unit: "week", days: [1] } })],
    });

    await openEventEditor(user, "Planning");
    await user.click(screen.getByRole("button", { name: "Edit custom repeat" }));

    const names = (await screen.findAllByRole("button", { pressed: false }))
      .map((b) => b.getAttribute("aria-label"))
      .filter((n) => n && /day$/.test(n) && n !== "Today");
    expect(names[0]).toBe("Sunday");
  });
});
