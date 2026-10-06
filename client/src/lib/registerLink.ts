export type RegisterLink = { token: string; email: string; server: string };

const trimSlashes = (url: string) => url.replace(/\/+$/, "");

export const sameServer = (a: string, b: string) =>
  trimSlashes(a) === trimSlashes(b);

export function parseRegisterLink(hash: string): RegisterLink | null {
  const encoded = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  if (!encoded) return null;

  try {
    const bytes = Uint8Array.from(
      atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    const { token, email, server } = JSON.parse(
      new TextDecoder().decode(bytes),
    ) as Record<string, unknown>;

    return [token, email, server].every((v) => typeof v === "string" && v)
      ? ({ token, email, server } as RegisterLink)
      : null;
  } catch {
    return null;
  }
}
