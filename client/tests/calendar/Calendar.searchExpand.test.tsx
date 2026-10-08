import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import {
  FIXED_NOW,
  buildEvent,
  getEventBlock,
  renderCalendar,
  setupCalendarTests,
} from "./helpers";

const session = vi.hoisted(() => ({
  user: { type: "online" },
  masterKey: {},
  bucketKey: {},
}));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => session,
}));

vi.mock("../../src/lib/calendar/buckets.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/calendar/buckets.ts")>()),
  computeExpandedRangeBuckets: vi.fn(async () => ["bucket"]),
}));

setupCalendarTests();

describe("Calendar search expansion", () => {
  it("keeps the visible events while adding the ones found further out", async () => {
    const far = buildEvent({
      id: "far-event",
      title: "Dentist",
      start: FIXED_NOW.plus({ weeks: 20 }).startOf("day").plus({ hours: 9 }),
      end: FIXED_NOW.plus({ weeks: 20 }).startOf("day").plus({ hours: 10 }),
    });
    const syncBuckets = vi.fn().mockResolvedValue([far]);
    renderCalendar({
      mode: "week",
      events: [buildEvent()],
      syncBuckets,
    });

    const input = await screen.findByPlaceholderText("Search events...");
    await act(async () => {
      fireEvent.change(input, { target: { value: "Dentist" } });
    });
    await act(() => new Promise((r) => setTimeout(r, 700)));

    expect(syncBuckets).toHaveBeenCalled();
    expect(await screen.findAllByText("Dentist")).not.toHaveLength(0);
    expect(await getEventBlock("Planning")).toBeInTheDocument();
  });
});
