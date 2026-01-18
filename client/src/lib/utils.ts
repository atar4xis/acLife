import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function domainName(url: string) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return "";
  }
}

export function joinUrl(base: string, path: string): string {
  if (!/^https?:\/\//i.test(base)) base = "https://" + base;
  if (base.endsWith("/")) base = base.slice(0, -1);
  if (path.startsWith("/")) path = path.slice(1);

  return `${base}/${path}`;
}

export function isColorDark(color: string): boolean {
  let r, g, b;

  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else {
      return false;
    }
  } else if (color.startsWith("rgb")) {
    const parts = color.match(/\d+/g);
    if (!parts || parts.length < 3) return false;
    r = Number(parts[0]);
    g = Number(parts[1]);
    b = Number(parts[2]);
  } else {
    return false;
  }

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 128;
}

export function formatPrice(currency: string, price: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(price / 100);
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  return bytesToBase64(new Uint8Array(buffer));
}

export function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) throw new Error("invalid UUID in uuidToBytes");

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

export function uuidToBase64(uuid: string): string {
  return bytesToBase64(uuidToBytes(uuid));
}

export function uint8ArrayFromBase64(b64: string): Uint8Array {
  const binary = atob(b64);

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

export function shallowEqual(
  a: Record<string, any> | null | undefined,
  b: Record<string, any> | null | undefined,
) {
  if (a === b) return true;
  if (!a || !b) return false;

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }

  return true;
}
