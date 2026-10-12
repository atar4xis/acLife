import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import {
  MAX_EVENT_NOTIFICATIONS,
  NOTIFY_WINDOW_DAYS,
  notificationTime,
  playNotificationSound,
  readCustomSound,
  sanitizeNotifications,
  upcomingNotifications,
} from "@/lib/calendar/notifications";
import type {
  CalendarEvent,
  EventNotification,
} from "@/types/calendar/Event";

const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });
const now = at("2026-03-02T08:00");

const event = (
  start: string,
  notifications: EventNotification[],
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id: "e1",
  title: "event",
  start: at(start),
  end: at(start).plus({ hours: 1 }),
  timestamp: 0,
  notifications,
  ...extra,
});

const sound = (when: EventNotification["when"], amount = 0) => ({
  when,
  amount,
  method: "sound" as const,
});

describe("notificationTime", () => {
  it.each([
    [sound("start"), "2026-03-02T09:00"],
    [sound("minutes", 15), "2026-03-02T08:45"],
    [sound("hours", 2), "2026-03-02T07:00"],
    [sound("days", 1), "2026-03-01T09:00"],
  ])("%j", (notification, expected) => {
    expect(notificationTime(at("2026-03-02T09:00"), notification)).toBe(
      at(expected).toMillis(),
    );
  });

  it("counts days on the calendar across a DST change", () => {
    const start = DateTime.fromISO("2026-03-30T09:00", {
      zone: "Europe/Berlin",
    });
    expect(notificationTime(start, sound("days", 2))).toBe(
      DateTime.fromISO("2026-03-28T09:00", { zone: "Europe/Berlin" }).toMillis(),
    );
  });
});

describe("sanitizeNotifications", () => {
  it("drops invalid entries and caps the list", () => {
    const valid = sound("minutes", 5);
    expect(
      sanitizeNotifications([
        valid,
        { when: "weeks", amount: 1, method: "sound" },
        { when: "minutes", amount: 1, method: "email" },
        { when: "minutes", amount: 1.5, method: "sound" },
        { when: "minutes", amount: 100, method: "sound" },
        { when: "minutes", amount: -1, method: "sound" },
        null,
        "x",
      ]),
    ).toEqual([valid]);

    expect(
      sanitizeNotifications(Array(5).fill(valid)),
    ).toHaveLength(MAX_EVENT_NOTIFICATIONS);
  });
});

describe("upcomingNotifications", () => {
  it("lists every notification of an event inside the window", () => {
    const due = upcomingNotifications(
      [event("2026-03-02T09:00", [sound("start"), sound("minutes", 30)])],
      now,
    );
    expect(due.map((d) => d.at)).toEqual([
      at("2026-03-02T09:00").toMillis(),
      at("2026-03-02T08:30").toMillis(),
    ]);
    expect(due[0]).toMatchObject({ eventId: "e1", method: "sound" });
  });

  it("skips times that have already passed", () => {
    expect(
      upcomingNotifications(
        [event("2026-03-02T08:30", [sound("start"), sound("minutes", 45)])],
        now,
      ).map((d) => d.at),
    ).toEqual([at("2026-03-02T08:30").toMillis()]);
  });

  it("only includes fire times inside the window", () => {
    const inside = at("2026-03-02T08:00").plus({ days: NOTIFY_WINDOW_DAYS });
    const due = upcomingNotifications(
      [
        event(inside.toISO()!, [sound("start")]),
        event(inside.plus({ minutes: 1 }).toISO()!, [sound("start")], {
          id: "e2",
        }),
      ],
      now,
    );
    expect(due.map((d) => d.eventId)).toEqual(["e1"]);
  });

  it("includes a fire time exactly at the end of the window, not after it", () => {
    const end = now.plus({ days: NOTIFY_WINDOW_DAYS });
    const at = (ms: number) =>
      upcomingNotifications(
        [event(end.plus({ milliseconds: ms }).toISO()!, [sound("start")])],
        now,
      );

    expect(at(0)).toHaveLength(1);
    expect(at(1)).toHaveLength(0);
  });

  it("does not notify for a time that is exactly now", () => {
    expect(
      upcomingNotifications([event(now.toISO()!, [sound("start")])], now),
    ).toEqual([]);
  });

  it("ignores the unused amount of a start notification", () => {
    expect(
      upcomingNotifications(
        [event("2026-03-02T09:00", [sound("start", 10)])],
        now,
      ).map((d) => d.at),
    ).toEqual([at("2026-03-02T09:00").toMillis()]);
  });

  it("includes occurrences moved from before the series start", () => {
    const due = upcomingNotifications(
      [
        event("2026-03-10T09:00", [sound("start")], {
          repeat: {
            interval: 1,
            unit: "day",
            until: at("2026-03-11T00:00").toMillis(),
            overrides: { "2026-03-04": { startShift: 0 } },
          },
        }),
      ],
      now,
    );
    expect(due.map((d) => d.at).toSorted()).toEqual([
      at("2026-03-04T09:00").toMillis(),
      at("2026-03-10T09:00").toMillis(),
    ]);
  });

  it("uses the notifications of an instance override", () => {
    const due = upcomingNotifications(
      [
        event("2026-03-01T09:00", [sound("start")], {
          repeat: {
            interval: 1,
            unit: "day",
            until: at("2026-03-05T00:00").toMillis(),
            overrides: {
              "2026-03-03": { notifications: [sound("minutes", 30)] },
              "2026-03-04": { notifications: [] },
            },
          },
        }),
      ],
      now,
    );
    expect(due.map((d) => d.at)).toEqual([
      at("2026-03-02T09:00").toMillis(),
      at("2026-03-03T08:30").toMillis(),
    ]);
  });

  it("notifies for an instance when only the override has notifications", () => {
    const due = upcomingNotifications(
      [
        event("2026-03-01T09:00", [], {
          repeat: {
            interval: 1,
            unit: "day",
            until: at("2026-03-04T00:00").toMillis(),
            overrides: { "2026-03-03": { notifications: [sound("start")] } },
          },
        }),
      ],
      now,
    );
    expect(due.map((d) => d.at)).toEqual([at("2026-03-03T09:00").toMillis()]);
  });

  it("skips occurrences without notifications when the parent has none", () => {
    const due = upcomingNotifications(
      [
        event("2026-03-01T09:00", [], {
          notifications: undefined,
          repeat: {
            interval: 1,
            unit: "day",
            until: at("2026-03-04T00:00").toMillis(),
            overrides: { "2026-03-03": { notifications: [sound("start")] } },
          },
        }),
      ],
      now,
    );
    expect(due.map((d) => d.at)).toEqual([at("2026-03-03T09:00").toMillis()]);
  });

  it("ignores malformed notifications", () => {
    const bad = { when: "weeks", amount: 0, method: "sound" };
    const due = upcomingNotifications(
      [
        event("2026-03-02T09:00", [
          bad as unknown as EventNotification,
          sound("start"),
        ]),
      ],
      now,
    );
    expect(due.map((d) => d.at)).toEqual([at("2026-03-02T09:00").toMillis()]);
  });

  it("notifies days ahead for an event that starts beyond the window", () => {
    const due = upcomingNotifications(
      [event("2026-03-20T09:00", [sound("days", 10)])],
      now,
    );
    expect(due.map((d) => d.at)).toEqual([at("2026-03-10T09:00").toMillis()]);
  });

  it("ignores events without notifications and completed tasks", () => {
    expect(
      upcomingNotifications(
        [
          event("2026-03-02T09:00", []),
          event("2026-03-02T09:00", [sound("start")], {
            id: "e2",
            isTask: true,
            completed: true,
          }),
        ],
        now,
      ),
    ).toEqual([]);
  });

  it("expands repeating events, once per occurrence", () => {
    const due = upcomingNotifications(
      [
        event("2026-03-01T09:00", [sound("start")], {
          repeat: { interval: 1, unit: "day" },
        }),
      ],
      now,
    );
    expect(due).toHaveLength(NOTIFY_WINDOW_DAYS);
    expect(due[0].at).toBe(at("2026-03-02T09:00").toMillis());
  });

  it("honours skipped dates and moved occurrences", () => {
    const due = upcomingNotifications(
      [
        event("2026-03-01T09:00", [sound("start")], {
          repeat: {
            interval: 1,
            unit: "day",
            until: at("2026-03-05T00:00").toMillis(),
            skip: ["2026-03-03"],
            overrides: { "2026-03-04": { startShift: 60 * 60 * 1000 } },
          },
        }),
      ],
      now,
    );
    expect(due.map((d) => d.at)).toEqual([
      at("2026-03-02T09:00").toMillis(),
      at("2026-03-04T10:00").toMillis(),
    ]);
  });

  it("does not notify for completed occurrences of a recurring task", () => {
    const due = upcomingNotifications(
      [
        event("2026-03-01T09:00", [sound("start")], {
          isTask: true,
          completedInstances: ["2026-03-02"],
          repeat: {
            interval: 1,
            unit: "day",
            until: at("2026-03-04T00:00").toMillis(),
          },
        }),
      ],
      now,
    );
    expect(due.map((d) => d.at)).toEqual([at("2026-03-03T09:00").toMillis()]);
  });

  it("keeps the notification method", () => {
    const due = upcomingNotifications(
      [
        event("2026-03-02T09:00", [
          { when: "start", amount: 0, method: "device" },
          { when: "minutes", amount: 5, method: "all" },
        ]),
      ],
      now,
    );
    expect(due.map((d) => d.method)).toEqual(["device", "all"]);
  });
});

describe("playNotificationSound", () => {
  const urls = { create: vi.fn(), revoke: vi.fn() };

  beforeEach(() => {
    urls.create.mockReset().mockImplementation((b: Blob) =>
      b.type.includes("sounds/") ? `blob:${b.type}` : "blob:custom",
    );
    urls.revoke.mockReset();
    URL.createObjectURL = urls.create;
    URL.revokeObjectURL = urls.revoke;
    vi.stubGlobal("fetch", async (url: string) => ({
      blob: async () => new Blob(["x"], { type: url }),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  const stubAudio = () => {
    const players: { src: string; volume: number; pause: () => void; play: () => Promise<void> }[] = [];
    vi.stubGlobal(
      "Audio",
      function (this: object, src: string) {
        const player = {
          src,
          volume: 1,
          pause: vi.fn(),
          play: vi.fn().mockResolvedValue(undefined),
        };
        players.push(player);
        return player;
      },
    );
    return players;
  };

  it("plays the numbered file at the given volume percent", async () => {
    const players = stubAudio();

    await playNotificationSound(4, 35);

    expect(players[0].src).toBe(`blob:${import.meta.env.BASE_URL}sounds/notification_4.mp3`);
    expect(players[0].volume).toBe(0.35);
    expect(players[0].play).toHaveBeenCalledTimes(1);
  });

  it("stops the previous sound before playing the next", async () => {
    const players = stubAudio();

    await playNotificationSound(1, 100);
    await playNotificationSound(2, 100);

    expect(players[0].pause).toHaveBeenCalledTimes(1);
    expect(players[1].play).toHaveBeenCalledTimes(1);
  });

  it("logs a play the browser refuses", async () => {
    const swallow = vi.fn();
    vi.stubGlobal("Audio", function () {
      return { pause: vi.fn(), play: () => ({ catch: swallow }) };
    });

    await playNotificationSound(1, 50);

    expect(swallow).toHaveBeenCalledWith(console.error);
  });

  describe("custom sound", () => {
    const custom = "data:audio/mpeg;base64,eA==";

    it("reads a file as a data url", async () => {
      expect(
        await readCustomSound(new File(["x"], "a.mp3", { type: "audio/mpeg" })),
      ).toBe(custom);
    });

    it("plays the custom sound", async () => {
      const players = stubAudio();

      await playNotificationSound(custom, 50);

      expect(players[0].src).toBe("blob:custom");
      const blob: Blob = urls.create.mock.calls[0][0];
      expect(blob.type).toBe("audio/mpeg");
      expect(blob.size).toBe(1);
      expect(players[0].volume).toBe(0.5);
    });
  });
});
