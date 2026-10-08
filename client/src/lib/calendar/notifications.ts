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
import { CUSTOM_NOTIFICATION_SOUND } from "@/lib/settingsDefaults";

export const MAX_EVENT_NOTIFICATIONS = 3;
export const MAX_NOTIFY_AMOUNT = 99;
export const NOTIFY_WINDOW_DAYS = 14;
export const NOTIFY_WHEN: NotifyWhen[] = ["start", "minutes", "hours", "days"];
export const NOTIFY_METHODS: NotifyMethod[] = ["sound", "device", "all"];

const CUSTOM_SOUND_CACHE = "acl-sound";
const CUSTOM_SOUND_KEY = "https://acl.invalid/custom";
export const MAX_CUSTOM_SOUND_BYTES = 1 << 20;

export const saveCustomSound = async (file: File) => {
  const cache = await caches.open(CUSTOM_SOUND_CACHE);
  await cache.put(CUSTOM_SOUND_KEY, new Response(file));
};

async function customSoundUrl() {
  if (!("caches" in window)) return;
  const cache = await caches.open(CUSTOM_SOUND_CACHE);
  const res = await cache.match(CUSTOM_SOUND_KEY);
  return res && URL.createObjectURL(await res.blob());
}

let sound: HTMLAudioElement | undefined;
let soundUrl: string | undefined;
let latestPlay = 0;

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

export async function playNotificationSound(number: number, volume: number) {
  const play = ++latestPlay;
  sound?.pause();
  const url =
    (number === CUSTOM_NOTIFICATION_SOUND
      ? await customSoundUrl()
      : undefined) ?? (await bundledSoundUrl(`notification_${number || 1}`));
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
