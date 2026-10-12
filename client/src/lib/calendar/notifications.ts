import { Duration, type DateTime } from "luxon";
import type {
  CalendarEvent,
  EventNotification,
  NotifyMethod,
  NotifyWhen,
} from "@/types/calendar/Event";
import { eventKey, makeOccurrence } from "@/lib/calendar/event";
import { occurrences } from "@/lib/calendar/occurrences";
import { overrideOccurrences } from "@/lib/calendar/recurrence";
import { uint8ArrayFromBase64 } from "@/lib/utils";

export const MAX_EVENT_NOTIFICATIONS = 3;
export const MAX_NOTIFY_AMOUNT = 99;
export const NOTIFY_WINDOW_DAYS = 14;
export const NOTIFY_WHEN: NotifyWhen[] = ["start", "minutes", "hours", "days"];
export const NOTIFY_METHODS: NotifyMethod[] = ["sound", "device", "all"];

export const MAX_CUSTOM_SOUND_BYTES = 64 << 10;

export const readCustomSound = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

let sound: HTMLAudioElement | undefined;
let soundUrl: string | undefined;
let latestPlay = 0;

const customSoundUrl = (dataUrl: string) => {
  const [header, base64] = dataUrl.split(",");
  return URL.createObjectURL(
    new Blob([uint8ArrayFromBase64(base64)], {
      type: header.slice("data:".length, header.indexOf(";")),
    }),
  );
};

const bundledSoundUrl = async (name: string) =>
  URL.createObjectURL(
    await (await fetch(`${import.meta.env.BASE_URL}sounds/${name}.mp3`)).blob(),
  );

export async function isSoundBlocked() {
  const url = await bundledSoundUrl("silence");
  const probe = new Audio(url);
  try {
    await probe.play();
    probe.pause();
    return false;
  } catch (e) {
    return (e as DOMException).name === "NotAllowedError";
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function playNotificationSound(
  number: number | string,
  volume: number,
) {
  const play = ++latestPlay;
  sound?.pause();
  const url =
    typeof number === "string"
      ? customSoundUrl(number)
      : await bundledSoundUrl(`notification_${number || 1}`);
  if (play !== latestPlay) {
    URL.revokeObjectURL(url);
    return;
  }

  if (soundUrl) URL.revokeObjectURL(soundUrl);
  soundUrl = url;
  sound = new Audio(url);
  sound.volume = volume / 100;
  void sound.play().catch(console.error);
}

export type DueNotification = {
  eventId: string;
  at: number;
  method: NotifyMethod;
};

export const isEventNotification = (n: unknown): n is EventNotification => {
  const { when, amount, method } = (n ?? {}) as Partial<EventNotification>;
  return (
    !!when &&
    NOTIFY_WHEN.includes(when) &&
    !!method &&
    NOTIFY_METHODS.includes(method) &&
    Number.isInteger(amount) &&
    amount! >= 0 &&
    amount! <= MAX_NOTIFY_AMOUNT
  );
};

export const sanitizeNotifications = (value: unknown[]) =>
  value.filter(isEventNotification).slice(0, MAX_EVENT_NOTIFICATIONS);

export const notificationTime = (start: DateTime, n: EventNotification) =>
  (n.when === "start" ? start : start.minus({ [n.when]: n.amount })).toMillis();

const instancesUntil = (event: CalendarEvent, now: DateTime, until: number) => {
  if (!event.repeat) return [event];

  const duration = event.end.diff(event.start);
  const generated: CalendarEvent[] = [];
  for (const start of occurrences(
    event.start,
    event.repeat,
    now.minus({ days: 1 }),
  )) {
    if (start.toMillis() > until) break;
    generated.push(makeOccurrence(event, start, start.toISODate()!, duration));
  }

  const all = new Map(
    [...generated, ...overrideOccurrences(event)].map((e) => [eventKey(e), e]),
  );
  return [...all.values()];
};

const configuredNotifications = (event: CalendarEvent) =>
  [
    ...(event.notifications ?? []),
    ...Object.values(event.repeat?.overrides ?? {}).flatMap(
      (o) => o.notifications ?? [],
    ),
  ].filter(isEventNotification);

const leadMillis = (n: EventNotification) =>
  n.when === "start"
    ? 0
    : Duration.fromObject({ [n.when]: n.amount }).toMillis();

export function upcomingNotifications(
  events: CalendarEvent[],
  now: DateTime,
): DueNotification[] {
  const from = now.toMillis();
  const to = now.plus({ days: NOTIFY_WINDOW_DAYS }).toMillis();

  return events.flatMap((event) => {
    const configured = configuredNotifications(event);
    if (!configured.length) return [];

    const reach = to + Math.max(...configured.map(leadMillis));
    return instancesUntil(event, now, reach)
      .filter((instance) => !instance.completed)
      .flatMap((instance) =>
        (instance.notifications ?? [])
          .filter(isEventNotification)
          .map((n) => ({
            eventId: event.id,
            at: notificationTime(instance.start, n),
            method: n.method,
          }))
          .filter(({ at }) => at > from && at <= to),
      );
  });
}
