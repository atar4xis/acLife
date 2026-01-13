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

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);

  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
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
