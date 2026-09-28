import { beforeEach, describe, expect, it, vi } from "vitest";

// argon2's WASM loader doesn't work under jsdom, so stub Worker with a SubtleCrypto-based hash
class FakeArgonWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;

  terminate() {}

  postMessage(data: { password: string; salt: number[]; hashLen: number }) {
    void crypto.subtle
      .digest(
        "SHA-256",
        new TextEncoder().encode(
          data.password + ":" + JSON.stringify(data.salt),
        ),
      )
      .then((digest) => {
        this.onmessage?.({
          data: { hash: Array.from(new Uint8Array(digest, 0, data.hashLen)) },
        } as MessageEvent);
      })
      .catch((err: unknown) => {
        this.onmessage?.({
          data: { error: err instanceof Error ? err.message : String(err) },
        } as MessageEvent);
      });
  }
}

vi.stubGlobal("Worker", FakeArgonWorker);

const {
  generateMasterKeyEnvelope,
  rewrapMasterKeyEnvelope,
  unwrapMasterKeyEnvelope,
} = await import("../../src/lib/crypt.ts");

describe("key envelopes", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", FakeArgonWorker);
  }, 30000);

  it("generates, then unwraps an envelope with the same password", async () => {
    const { masterKey, bucketKey, envelope } = await generateMasterKeyEnvelope(
      "correct-password-123!",
      true,
    );

    expect(envelope.type).toBe("master");
    expect(envelope.version).toBe(1);

    const unwrapped = await unwrapMasterKeyEnvelope(
      "correct-password-123!",
      envelope,
      true,
    );

    const [originalRaw, unwrappedRaw] = await Promise.all([
      crypto.subtle.exportKey("raw", masterKey),
      crypto.subtle.exportKey("raw", unwrapped.masterKey),
    ]);
    expect(new Uint8Array(unwrappedRaw)).toEqual(new Uint8Array(originalRaw));

    // bucketKey is non-extractable, so compare by signing the same message instead
    const message = new TextEncoder().encode("probe");
    const [originalSig, unwrappedSig] = await Promise.all([
      crypto.subtle.sign("HMAC", bucketKey, message),
      crypto.subtle.sign("HMAC", unwrapped.bucketKey, message),
    ]);
    expect(new Uint8Array(unwrappedSig)).toEqual(new Uint8Array(originalSig));
  }, 30000);

  it("rejects unwrapping with the wrong password", async () => {
    const { envelope } = await generateMasterKeyEnvelope("correct-password-123!");

    await expect(
      unwrapMasterKeyEnvelope("wrong-password-456!", envelope),
    ).rejects.toThrow();
  }, 30000);

  it("rewraps the same master key under a new password", async () => {
    const { masterKey, envelope: firstEnvelope } =
      await generateMasterKeyEnvelope("old-password-123!", true);

    const rewrapped = await rewrapMasterKeyEnvelope(
      "new-password-456!",
      masterKey,
    );

    expect(rewrapped.salt).not.toBe(firstEnvelope.salt);

    const unwrapped = await unwrapMasterKeyEnvelope(
      "new-password-456!",
      rewrapped,
      true,
    );

    const [originalRaw, unwrappedRaw] = await Promise.all([
      crypto.subtle.exportKey("raw", masterKey),
      crypto.subtle.exportKey("raw", unwrapped.masterKey),
    ]);
    expect(new Uint8Array(unwrappedRaw)).toEqual(new Uint8Array(originalRaw));
  }, 30000);
});
