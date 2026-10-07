import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeArgonWorker } from "./fakeArgonWorker";

vi.stubGlobal("Worker", FakeArgonWorker);

const {
  decrypt,
  deriveMasterKey,
  encrypt,
  exportKeyPair,
  generateMasterKeyEnvelope,
  importKeyPair,
  protectUnlockKeys,
  randomBytes,
  rewrapMasterKeyEnvelope,
  SRP_PARAMS,
  unwrapKeyPairWithPin,
  unwrapMasterKeyEnvelope,
  wrapKeyPairWithPin,
} = await import("../../src/lib/crypt.ts");
const { arrayBufferToBase64 } = await import("../../src/lib/utils.ts");

const sign = async (key: CryptoKey) =>
  new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("probe")),
  );

const decryptsWith = async (key: CryptoKey, other: CryptoKey) => {
  const plain = new TextEncoder().encode("hello");
  const decrypted = await decrypt(await encrypt(plain, other), key);
  return new TextDecoder().decode(decrypted) === "hello";
};

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

  it("keeps non-extractable stay-unlocked keys as they are on web", async () => {
    const keys = await generateMasterKeyEnvelope("password-123!");

    const stored = await protectUnlockKeys(keys);

    expect(stored).toBe(keys);
  }, 30000);

  it("round-trips a key pair through export and import", async () => {
    const { masterKey, bucketKey, exported } = await makeKeys();
    const imported = await importKeyPair(
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );

    expect(imported.masterKey.extractable).toBe(false);
    expect(imported.bucketKey.extractable).toBe(false);
    expect(await decryptsWith(imported.masterKey, masterKey)).toBe(true);
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

    const unwrapped = await unwrapKeyPairWithPin("1234", wrapped);

    expect(await decryptsWith(unwrapped.masterKey, masterKey)).toBe(true);
    expect(await sign(unwrapped.bucketKey)).toEqual(await sign(bucketKey));
    expect(unwrapped.upgraded).toBeNull();
    expect(wrapped.kdf).toEqual({ time: 3, mem: 65536 });
    expect(wrapped.keystore).toBeUndefined();
  }, 30000);

  it("unwraps a blob without stored cost params using the old PIN cost", async () => {
    const { masterKey, exported } = await makeKeys();
    const salt = randomBytes(16);
    const { masterKey: pinKey } = await deriveMasterKey("1234", salt, false, {
      time: 8,
      mem: 131072,
    });
    const legacy = {
      salt: arrayBufferToBase64(salt.buffer),
      encrypted: arrayBufferToBase64(
        await encrypt(
          new TextEncoder().encode(JSON.stringify(exported)),
          pinKey,
        ),
      ),
    };

    const unwrapped = await unwrapKeyPairWithPin("1234", legacy);

    expect(await decryptsWith(unwrapped.masterKey, masterKey)).toBe(true);
    expect(FakeArgonWorker.requests.at(-1)).toMatchObject({
      time: 8,
      mem: 131072,
    });
  }, 30000);

  it("rejects unwrapping with the wrong PIN", async () => {
    const { exported } = await makeKeys();
    const wrapped = await wrapKeyPairWithPin(
      "1234",
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );

    await expect(
      unwrapKeyPairWithPin("4321", wrapped),
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

describe("SRP_PARAMS kdf", () => {
  const salt = new Uint8Array(16).fill(7);

  beforeEach(() => {
    FakeArgonWorker.requests = [];
  });

  it("runs Argon2id with the envelope cost and a labelled salt", async () => {
    await SRP_PARAMS.kdf("user@example.com", "pw", salt);

    expect(FakeArgonWorker.requests).toHaveLength(1);
    const req = FakeArgonWorker.requests[0];
    expect(req).toMatchObject({
      password: "user@example.com:pw",
      type: 2,
      time: 3,
      mem: 65536,
      parallelism: 1,
      hashLen: 32,
    });
    expect(
      new TextDecoder().decode(new Uint8Array(req.salt.slice(0, 13))),
    ).toBe("acLife-srp-v2");
    expect(req.salt.slice(13)).toEqual(Array.from(salt));
  });

  it("depends on username, password and salt", async () => {
    const outputs = await Promise.all([
      SRP_PARAMS.kdf("user@example.com", "pw", salt),
      SRP_PARAMS.kdf("other@example.com", "pw", salt),
      SRP_PARAMS.kdf("user@example.com", "pw2", salt),
      SRP_PARAMS.kdf("user@example.com", "pw", new Uint8Array(16).fill(8)),
    ]);

    expect(new Set(outputs.map((o) => o.join(","))).size).toBe(outputs.length);
    expect(await SRP_PARAMS.kdf("user@example.com", "pw", salt)).toEqual(
      outputs[0],
    );
  });
});
