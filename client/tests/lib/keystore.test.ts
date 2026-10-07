import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeArgonWorker } from "./fakeArgonWorker";

vi.stubGlobal("Worker", FakeArgonWorker);
Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {} });

const invokeMock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => invokeMock);

const {
  decrypt,
  encrypt,
  exportKeyPair,
  generateMasterKeyEnvelope,
  KeystoreUnavailableError,
  protectUnlockKeys,
  restoreUnlockKeys,
  unwrapKeyPairWithPin,
  wrapKeyPairWithPin,
} = await import("../../src/lib/crypt.ts");

const deviceKeyBytes = Array.from({ length: 32 }, (_, i) => i);

const makeKeys = async () => {
  const { masterKey, bucketKey } = await generateMasterKeyEnvelope(
    "password-123!",
    true,
  );
  return { masterKey, bucketKey, exported: await exportKeyPair(masterKey, bucketKey) };
};

const roundTrips = async (key: CryptoKey, other: CryptoKey) => {
  const plain = new TextEncoder().encode("hello");
  return (
    new TextDecoder().decode(await decrypt(await encrypt(plain, other), key)) ===
    "hello"
  );
};

beforeEach(() => {
  vi.restoreAllMocks();
  invokeMock.invoke.mockReset().mockResolvedValue(deviceKeyBytes);
  FakeArgonWorker.requests = [];
});

describe("keystore device key", () => {
  it("wraps the PIN blob with the keystore key and the cheap cost", async () => {
    const { masterKey, exported } = await makeKeys();

    const wrapped = await wrapKeyPairWithPin(
      "1234",
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );

    expect(invokeMock.invoke).toHaveBeenCalledWith("device_key");
    expect(wrapped.keystore).toBe(true);
    expect(wrapped.kdf).toEqual({ time: 2, mem: 16384 });
    const unwrapped = await unwrapKeyPairWithPin("1234", wrapped);
    expect(await roundTrips(unwrapped.masterKey, masterKey)).toBe(true);
    expect(unwrapped.upgraded).toBeNull();
  }, 30000);

  it("cannot unwrap without the keystore key", async () => {
    const { exported } = await makeKeys();
    const wrapped = await wrapKeyPairWithPin(
      "1234",
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );
    invokeMock.invoke.mockResolvedValue(deviceKeyBytes.map((b) => b + 1));

    await expect(unwrapKeyPairWithPin("1234", wrapped)).rejects.toThrow();
  }, 30000);

  it("fails with KeystoreUnavailableError before hashing when the keystore is gone", async () => {
    const { exported } = await makeKeys();
    const wrapped = await wrapKeyPairWithPin(
      "1234",
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );
    FakeArgonWorker.requests = [];
    invokeMock.invoke.mockRejectedValue(new Error("no keystore"));

    await expect(unwrapKeyPairWithPin("1234", wrapped)).rejects.toBeInstanceOf(
      KeystoreUnavailableError,
    );
    expect(FakeArgonWorker.requests).toHaveLength(0);
  }, 30000);

  it("reports a changed keystore key as unavailable, not as a wrong PIN", async () => {
    const { exported } = await makeKeys();
    const wrapped = await wrapKeyPairWithPin(
      "1234",
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );
    invokeMock.invoke.mockResolvedValue(deviceKeyBytes.map((b) => b + 1));

    await expect(unwrapKeyPairWithPin("1234", wrapped)).rejects.toBeInstanceOf(
      KeystoreUnavailableError,
    );
  }, 30000);

  it("falls back to the old cost when the keystore is unavailable", async () => {
    invokeMock.invoke.mockRejectedValue(new Error("no keystore"));
    const { exported } = await makeKeys();

    const wrapped = await wrapKeyPairWithPin(
      "1234",
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );

    expect(wrapped.keystore).toBeUndefined();
    expect(wrapped.kdf).toEqual({ time: 3, mem: 65536 });
  }, 30000);

  it("upgrades a blob without keystore protection", async () => {
    invokeMock.invoke.mockRejectedValue(new Error("no keystore"));
    const { masterKey, exported } = await makeKeys();
    const old = await wrapKeyPairWithPin(
      "1234",
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );
    invokeMock.invoke.mockResolvedValue(deviceKeyBytes);

    const unwrapped = await unwrapKeyPairWithPin("1234", old);

    expect(unwrapped.upgraded?.keystore).toBe(true);
    const again = await unwrapKeyPairWithPin("1234", unwrapped.upgraded!);
    expect(await roundTrips(again.masterKey, masterKey)).toBe(true);
  }, 30000);

  it("still unlocks when the upgrade cannot be written", async () => {
    invokeMock.invoke.mockRejectedValue(new Error("no keystore"));
    const { masterKey, exported } = await makeKeys();
    const old = await wrapKeyPairWithPin(
      "1234",
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );

    const unwrapped = await unwrapKeyPairWithPin("1234", old);

    expect(unwrapped.upgraded).toBeNull();
    expect(await roundTrips(unwrapped.masterKey, masterKey)).toBe(true);
  }, 30000);

  it("still unlocks when re-wrapping the blob fails", async () => {
    invokeMock.invoke.mockRejectedValue(new Error("no keystore"));
    const { masterKey, exported } = await makeKeys();
    const old = await wrapKeyPairWithPin(
      "1234",
      exported.masterKeyB64,
      exported.bucketKeyB64,
    );
    invokeMock.invoke.mockResolvedValue(deviceKeyBytes);
    vi.spyOn(crypto.subtle, "encrypt").mockRejectedValueOnce(new Error("boom"));

    const unwrapped = await unwrapKeyPairWithPin("1234", old);

    expect(unwrapped.upgraded).toBeNull();
    expect(await roundTrips(unwrapped.masterKey, masterKey)).toBe(true);
  }, 30000);

  it("protects and restores stay-unlocked keys", async () => {
    const { masterKey, bucketKey } = await makeKeys();

    const stored = await protectUnlockKeys({ masterKey, bucketKey });

    expect(stored).toEqual({ encrypted: expect.any(String) });
    const restored = await restoreUnlockKeys(stored);
    expect(await roundTrips(restored.masterKey, masterKey)).toBe(true);
  }, 30000);

  it("stores stay-unlocked keys as non-extractable keys when the keystore is unavailable", async () => {
    invokeMock.invoke.mockRejectedValue(new Error("no keystore"));
    const keys = await makeKeys();

    const stored = await protectUnlockKeys(keys);

    expect("encrypted" in stored).toBe(false);
    const { masterKey, bucketKey } = await restoreUnlockKeys(stored);
    expect(masterKey.extractable).toBe(false);
    expect(bucketKey.extractable).toBe(false);
    expect(await roundTrips(masterKey, keys.masterKey)).toBe(true);
  }, 30000);

  it("rejects stored keys in an unknown format", async () => {
    await expect(
      restoreUnlockKeys({ masterKeyB64: "m" } as never),
    ).rejects.toThrow();
  });
});
