import { CLIENT_ID } from "@/lib/clientId";
import type { EncryptedEvent } from "@/types/calendar/Event";

export type StreamMessageType = "sync" | "settings" | "calendar";

export type CalendarChange =
  | { type: "deleted"; id: string }
  | ({ type: "added" | "updated" } & Omit<EncryptedEvent, "buckets">);

export type StreamMessage = {
  type: StreamMessageType;
  originClientId?: string;
  changes?: CalendarChange[];
};

export const stream = new EventTarget();

export function emitStream(message: StreamMessage) {
  stream.dispatchEvent(new CustomEvent(message.type, { detail: message }));
}

export const isOwnMessage = (message: StreamMessage) =>
  message.originClientId === CLIENT_ID;

// includes this client's own messages, the stream service emits sync and settings without an origin after a possible gap
export function onStream(
  type: StreamMessageType,
  callback: (message: StreamMessage) => void,
) {
  const listener = (ev: Event) =>
    callback((ev as CustomEvent<StreamMessage>).detail);
  stream.addEventListener(type, listener);
  return () => stream.removeEventListener(type, listener);
}
