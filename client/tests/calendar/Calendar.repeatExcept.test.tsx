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
      "Repeat cannot exclude every day.",
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
