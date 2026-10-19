import { describe, expect, it } from "vitest";
import {
  deriveSpaceKeys,
  fingerprint,
  generateKeyPair,
  generateSpaceKey,
  unwrapPrivateKey,
  unwrapSpaceKey,
  unwrapSpaceKeyForOwner,
  wrapPrivateKey,
  wrapSpaceKey,
  wrapSpaceKeyForOwner,
} from "../../src/lib/shareCrypto";
import { decrypt, encrypt } from "../../src/lib/crypt";
import { arrayBufferToBase64 } from "../../src/lib/utils";

const masterKey = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);

const SPACE = "11111111-1111-4111-8111-111111111111";

const b64 = (bytes: Uint8Array<ArrayBuffer>) =>
  arrayBufferToBase64(bytes.buffer);

describe("key pair", () => {
  it("exports an uncompressed P-256 public key", async () => {
    const pair = await generateKeyPair();
    expect(pair.publicKey.length).toBe(65);
    expect(pair.publicKey[0]).toBe(4);
  });

  it("wraps the private key with the master key and unwraps it to the same key", async () => {
    const master = await masterKey();
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();

    const wrapped = await wrapPrivateKey(alice.privateKey, master);
    const restored = await unwrapPrivateKey(wrapped, master);

    const raw = generateSpaceKey();
    const forAlice = await wrapSpaceKey(
      raw,
      bob.privateKey,
      b64(alice.publicKey),
      SPACE,
    );
    expect(
      await unwrapSpaceKey(forAlice, restored, b64(bob.publicKey), SPACE),
    ).toEqual(raw);

    const forBob = await wrapSpaceKey(
      raw,
      alice.privateKey,
      b64(bob.publicKey),
      SPACE,
    );
    await expect(
      unwrapSpaceKey(forBob, restored, b64(alice.publicKey), SPACE),
    ).rejects.toThrow();
  });

  it("does not unwrap the private key with another master key", async () => {
    const alice = await generateKeyPair();
    const wrapped = await wrapPrivateKey(alice.privateKey, await masterKey());
    await expect(
      unwrapPrivateKey(wrapped, await masterKey()),
    ).rejects.toThrow();
  });
});

describe("space key wrapping", () => {
  it("round trips between owner and recipient", async () => {
    const owner = await generateKeyPair();
    const bob = await generateKeyPair();
    const raw = generateSpaceKey();

    const wrapped = await wrapSpaceKey(
      raw,
      owner.privateKey,
      b64(bob.publicKey),
      SPACE,
    );
    expect(
      await unwrapSpaceKey(
        wrapped,
        bob.privateKey,
        b64(owner.publicKey),
        SPACE,
      ),
    ).toEqual(raw);
  });

  it("rejects a wrap presented for another space", async () => {
    const owner = await generateKeyPair();
    const bob = await generateKeyPair();
    const wrapped = await wrapSpaceKey(
      generateSpaceKey(),
      owner.privateKey,
      b64(bob.publicKey),
      SPACE,
    );

    await expect(
      unwrapSpaceKey(wrapped, bob.privateKey, b64(owner.publicKey), "other"),
    ).rejects.toThrow();
  });

  it("differs on every wrap", async () => {
    const owner = await generateKeyPair();
    const bob = await generateKeyPair();
    const wrap = () =>
      wrapSpaceKey(
        generateSpaceKey(),
        owner.privateKey,
        b64(bob.publicKey),
        SPACE,
      );

    expect(await wrap()).not.toBe(await wrap());
  });

  it("rejects a wrap forged by someone who claims to be the owner", async () => {
    const owner = await generateKeyPair();
    const forger = await generateKeyPair();
    const bob = await generateKeyPair();

    const forged = await wrapSpaceKey(
      generateSpaceKey(),
      forger.privateKey,
      b64(bob.publicKey),
      SPACE,
    );

    await expect(
      unwrapSpaceKey(forged, bob.privateKey, b64(owner.publicKey), SPACE),
    ).rejects.toThrow();
  });

  it("rejects tampered and truncated wraps", async () => {
    const owner = await generateKeyPair();
    const bob = await generateKeyPair();
    const wrapped = await wrapSpaceKey(
      generateSpaceKey(),
      owner.privateKey,
      b64(bob.publicKey),
      SPACE,
    );
    const unwrap = (value: string) =>
      unwrapSpaceKey(value, bob.privateKey, b64(owner.publicKey), SPACE);

    const bytes = Uint8Array.from(atob(wrapped), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 1;
    await expect(unwrap(btoa(String.fromCharCode(...bytes)))).rejects.toThrow();
    await expect(unwrap("AAAA")).rejects.toThrow();
  });

  it("seals the owner's copy with the master key", async () => {
    const master = await masterKey();
    const bytes = new TextEncoder().encode("secret");
    const sealed = await wrapSpaceKeyForOwner(bytes, master);

    expect(Array.from(await unwrapSpaceKeyForOwner(sealed, master))).toEqual(
      Array.from(bytes),
    );
    await expect(
      unwrapSpaceKeyForOwner(sealed, await masterKey()),
    ).rejects.toThrow();
  });
});

describe("space keys", () => {
  it("encrypt and decrypt with the data key, the bucket key signs", async () => {
    const raw = generateSpaceKey();
    const { key, bucketKey } = await deriveSpaceKeys(raw);

    const sealed = await encrypt(new TextEncoder().encode("hello"), key);
    expect(new TextDecoder().decode(await decrypt(sealed, key))).toBe("hello");

    const other = await deriveSpaceKeys(generateSpaceKey());
    await expect(decrypt(sealed, other.key)).rejects.toThrow();

    const sign = async (k: CryptoKey) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.sign(
            "HMAC",
            k,
            new TextEncoder().encode("2026-W01"),
          ),
        ),
      );
    const again = await deriveSpaceKeys(raw);
    expect(await sign(bucketKey)).toEqual(await sign(again.bucketKey));
    expect(await sign(bucketKey)).not.toEqual(await sign(other.bucketKey));
  });

  it("derives the bucket key as HKDF-SHA256 of the key with the share bucket label", async () => {
    const raw = generateSpaceKey();
    const { bucketKey } = await deriveSpaceKeys(raw);

    const hkdf = await crypto.subtle.importKey("raw", raw, "HKDF", false, [
      "deriveKey",
    ]);
    const expected = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: new TextEncoder().encode("acLife-share-bucket-v1"),
      },
      hkdf,
      { name: "HMAC", hash: "SHA-256", length: 256 },
      false,
      ["sign"],
    );
    const sign = async (k: CryptoKey) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.sign(
            "HMAC",
            k,
            new TextEncoder().encode("2026-W01"),
          ),
        ),
      );
    expect(await sign(bucketKey)).toEqual(await sign(expected));
  });

  it("keeps the data key and the bucket key apart", async () => {
    const { bucketKey } = await deriveSpaceKeys(generateSpaceKey());
    await expect(
      encrypt(new TextEncoder().encode("x"), bucketKey),
    ).rejects.toThrow();
  });
});

describe("fingerprint", () => {
  it("is six groups of five digits, stable per key", async () => {
    const pair = await generateKeyPair();
    const print = await fingerprint(b64(pair.publicKey));

    expect(print).toMatch(/^(\d{5} ){5}\d{5}$/);
    expect(await fingerprint(b64(pair.publicKey))).toBe(print);
  });

  it("differs between keys", async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    expect(await fingerprint(b64(a.publicKey))).not.toBe(
      await fingerprint(b64(b.publicKey)),
    );
  });
});
