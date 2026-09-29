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
  exportKeyPair,
  generateMasterKeyEnvelope,
  importKeyPair,
  rewrapMasterKeyEnvelope,
  unwrapKeyPairWithPin,
  unwrapMasterKeyEnvelope,
  wrapKeyPairWithPin,
} = await import("../../src/lib/crypt.ts");

const sign = async (key: CryptoKey) =>
  new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("probe")),
  );

const rawKey = async (key: CryptoKey) =>
  new Uint8Array(await crypto.subtle.exportKey("raw", key));

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

describe("key pair export and PIN wrapping", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", FakeArgonWorker);
  }, 30000);

  const makeKeys = async () => {
    const keys = await generateMasterKeyEnvelope("password-123!", true);
    return {
      ...keys,
      exported: await exportKeyPair(keys.masterKey, keys.bucketKey),
    };
  };

  it("round-trips a key pair through export and import", async () => {
    const { masterKey, bucketKey, exported } = await makeKeys();
    const imported = await importKeyPair(
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );

    expect(await rawKey(imported.masterKey)).toEqual(await rawKey(masterKey));
    expect(await sign(imported.bucketKey)).toEqual(await sign(bucketKey));
  }, 30000);

  it("refuses to export non-extractable keys", async () => {
    const { masterKey, bucketKey } =
      await generateMasterKeyEnvelope("password-123!");

    await expect(exportKeyPair(masterKey, bucketKey)).rejects.toThrow();
  }, 30000);

  it("unwraps a PIN-wrapped key pair with the right PIN", async () => {
    const { masterKey, bucketKey, exported } = await makeKeys();
    const wrapped = await wrapKeyPairWithPin(
      "1234",
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );

    const unwrapped = await unwrapKeyPairWithPin(
      "1234",
      wrapped.salt,
      wrapped.encrypted,
    );

    expect(await rawKey(unwrapped.masterKey)).toEqual(await rawKey(masterKey));
    expect(await sign(unwrapped.bucketKey)).toEqual(await sign(bucketKey));
  }, 30000);

  it("rejects unwrapping with the wrong PIN", async () => {
    const { exported } = await makeKeys();
    const wrapped = await wrapKeyPairWithPin(
      "1234",
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );

    await expect(
      unwrapKeyPairWithPin("4321", wrapped.salt, wrapped.encrypted),
    ).rejects.toThrow();
  }, 30000);

  it("uses a fresh salt for every wrap", async () => {
    const { exported } = await makeKeys();
    const [a, b] = await Promise.all([
      wrapKeyPairWithPin("1234", exported.masterKeyB64, exported.bucketKeyB64),
      wrapKeyPairWithPin("1234", exported.masterKeyB64, exported.bucketKeyB64),
    ]);

    expect(a.salt).not.toBe(b.salt);
    expect(a.encrypted).not.toBe(b.encrypted);
  }, 30000);
});
