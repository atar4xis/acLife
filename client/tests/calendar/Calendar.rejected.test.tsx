import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => ({
    user: { type: "online", id: "user-1" },
    masterKey: {} as CryptoKey,
    bucketKey: {} as CryptoKey,
    setUser: () => {},
    setMasterKey: () => {},
    setBucketKey: () => {},
    logout: () => {},
    checkLogin: async () => {},
  }),
}));

import { act, screen } from "@testing-library/react";
import { toast } from "sonner";
import type { CalendarEvent, RejectedEvent } from "../../src/types/calendar/Event.ts";
import {
  advanceSave,
  buildEvent,
  buildPlainEvent,
  openEventEditor,
  renderCalendar,
  setupCalendarTests,
} from "./helpers";

setupCalendarTests();

type Save = (
  changes: { type: string; id?: string; event?: CalendarEvent }[],
  cb: () => void,
  onRejected: (rejected: RejectedEvent[]) => void,
) => void;

const retro = () =>
  buildEvent({
    id: "second-event",
    title: "Retro",
    description: undefined,
    start: buildPlainEvent().start.plus({ hours: 3 }),
    end: buildPlainEvent().end.plus({ hours: 3 }),
  });

const rename = async (
  user: ReturnType<typeof renderCalendar>["user"],
  from: string,
  to: string,
) => {
  await openEventEditor(user, from);
  const input = screen.getByDisplayValue(from);
  await user.clear(input);
  await user.type(input, to);
  await user.click(screen.getByRole("button", { name: /^save$/i }));
  await advanceSave();
};

describe("an edit the server cannot store", () => {
  it("is undone on screen, restoring the last saved version", async () => {
    const saveEvents = vi.fn<Save>();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents: saveEvents as never,
    });

    await rename(user, "Planning", "Planning with a huge note");
    expect(await screen.findByText("Planning with a huge note")).toBeInTheDocument();

    const [, , onRejected] = saveEvents.mock.calls[0];
    act(() =>
      onRejected([
        {
          id: "plain-event",
          title: "Planning with a huge note",
          wasAdded: false,
          previous: buildPlainEvent(),
        },
      ]),
    );

    expect(await screen.findByText("Planning")).toBeInTheDocument();
    expect(screen.queryByText("Planning with a huge note")).toBeNull();
  });

  it("is not resent with the next save", async () => {
    const saveEvents = vi.fn<Save>();
    const { user } = renderCalendar({
      events: [buildPlainEvent(), retro()],
      saveEvents: saveEvents as never,
    });

    await rename(user, "Planning", "Planning with a huge note");
    const [, , onRejected] = saveEvents.mock.calls[0];
    act(() =>
      onRejected([
        {
          id: "plain-event",
          title: "Planning with a huge note",
          wasAdded: false,
          previous: buildPlainEvent(),
        },
      ]),
    );
    await rename(user, "Retro", "Retro again");

    const second = saveEvents.mock.calls[1][0];
    expect(second.map((c) => c.event?.id ?? c.id)).toEqual(["second-event"]);
  });

  it("removes an event that was never saved", async () => {
    const saveEvents = vi.fn<Save>();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents: saveEvents as never,
    });

    await rename(user, "Planning", "Planning with a huge note");
    const [, , onRejected] = saveEvents.mock.calls[0];
    act(() =>
      onRejected([
        {
          id: "plain-event",
          title: "Planning with a huge note",
          wasAdded: true,
        },
      ]),
    );

    expect(screen.queryByText("Planning with a huge note")).toBeNull();
    expect(screen.queryByText("Planning")).toBeNull();
  });

  it("leaves other events alone", async () => {
    const saveEvents = vi.fn<Save>();
    const { user } = renderCalendar({
      events: [buildPlainEvent(), retro()],
      saveEvents: saveEvents as never,
    });

    await rename(user, "Planning", "Planning with a huge note");
    const [, , onRejected] = saveEvents.mock.calls[0];
    act(() =>
      onRejected([
        {
          id: "plain-event",
          title: "Planning with a huge note",
          wasAdded: false,
          previous: buildPlainEvent(),
        },
      ]),
    );

    expect(await screen.findByText("Retro")).toBeInTheDocument();
  });

  it("resyncs when there is no saved version to restore", async () => {
    const saveEvents = vi.fn<Save>();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents: saveEvents as never,
      syncEvents: vi.fn().mockResolvedValue([buildPlainEvent()]),
    });

    await rename(user, "Planning", "Planning with a huge note");
    vi.mocked(toast.promise).mockClear();
    const [, , onRejected] = saveEvents.mock.calls[0];
    await act(async () =>
      onRejected([
        {
          id: "plain-event",
          title: "Planning with a huge note",
          wasAdded: false,
        },
      ]),
    );

    expect(toast.promise).toHaveBeenCalledTimes(1);
  });

  it("does not resync when it could restore the saved version", async () => {
    const saveEvents = vi.fn<Save>();
    const { user } = renderCalendar({
      events: [buildPlainEvent()],
      saveEvents: saveEvents as never,
    });

    await rename(user, "Planning", "Planning with a huge note");
    vi.mocked(toast.promise).mockClear();
    const [, , onRejected] = saveEvents.mock.calls[0];
    act(() =>
      onRejected([
        {
          id: "plain-event",
          title: "Planning with a huge note",
          wasAdded: false,
          previous: buildPlainEvent(),
        },
      ]),
    );

    expect(toast.promise).not.toHaveBeenCalled();
  });

  it("does not come back through undo", async () => {
    const saveEvents = vi.fn<Save>();
    const { user } = renderCalendar({
      events: [buildPlainEvent(), retro()],
      saveEvents: saveEvents as never,
    });

    await rename(user, "Planning", "Planning with a huge note");
    await rename(user, "Retro", "Retro again");
    const [, , onRejected] = saveEvents.mock.calls[0];
    act(() =>
      onRejected([
        {
          id: "plain-event",
          title: "Planning with a huge note",
          wasAdded: false,
          previous: buildPlainEvent(),
        },
      ]),
    );
    await user.keyboard("{Control>}z{/Control}");

    expect(await screen.findByText("Retro")).toBeInTheDocument();
    expect(screen.queryByText("Planning with a huge note")).toBeNull();
    expect(screen.getByText("Planning")).toBeInTheDocument();
  });

  it("does not come back through redo", async () => {
    const saveEvents = vi.fn<Save>();
    const { user } = renderCalendar({
      events: [buildPlainEvent(), retro()],
      saveEvents: saveEvents as never,
    });

    await rename(user, "Planning", "Planning with a huge note");
    await rename(user, "Retro", "Retro again");
    await user.keyboard("{Control>}z{/Control}");
    const [, , onRejected] = saveEvents.mock.calls[0];
    act(() =>
      onRejected([
        {
          id: "plain-event",
          title: "Planning with a huge note",
          wasAdded: false,
          previous: buildPlainEvent(),
        },
      ]),
    );
    await user.keyboard("{Control>}y{/Control}");

    expect(await screen.findByText("Retro again")).toBeInTheDocument();
    expect(screen.queryByText("Planning with a huge note")).toBeNull();
  });
});
