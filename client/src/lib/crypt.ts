import type { Encrypted, EnvelopeKDFParams, KDFCost } from "@/types/Crypt";
import { invoke } from "@tauri-apps/api/core";
import type {
  StoredKeyPair,
  WrappedKeyPair,
  WrappedUnlockKeys,
} from "@/types/Storage";
import { isTauri } from "./nativeUpdater";
import {
  RFC5054Group4096,
  Triplet,
  concatUint8Array,
  generateSalt,
  type Params,
} from "@mzattahri/srp";
import { compress, decompress } from "./gzip";
import { arrayBufferToBase64, uint8ArrayFromBase64 } from "./utils";
import { t } from "@/i18n";

export const MAX_PASSWORD_LENGTH = 256;

const srpHash = async (...inputs: Uint8Array[]) => {
  const data = new Uint8Array(concatUint8Array(...inputs));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
};

const SRP_KDF_LABEL = new TextEncoder().encode("acLife-srp-v2");

export const SRP_PARAMS: Params = {
  name: "DH16-SHA256-Argon2id",
  group: RFC5054Group4096,
  hash: srpHash,
  kdf: (username: string, password: string, salt: Uint8Array) =>
    argon2Hash(
      `${username}:${password}`,
      new Uint8Array(concatUint8Array(SRP_KDF_LABEL, salt)),
      {
        time: DEFAULT_ENVELOPE_KDF.time,
        mem: DEFAULT_ENVELOPE_KDF.mem,
        hashLen: DEFAULT_ENVELOPE_KDF.hashLen,
        parallelism: DEFAULT_ENVELOPE_KDF.parallelism,
        type: ArgonType.Argon2id,
      },
    ),
};

// matches argon2-browser's ArgonType enum
export const ArgonType = {
  Argon2d: 0,
  Argon2i: 1,
  Argon2id: 2,
} as const;

const BUCKET_KEY_INFO = new TextEncoder().encode("acLife-bucket-key-v1");

export type DerivedKeys = {
  masterKey: CryptoKey;
  bucketKey: CryptoKey;
};

export const DEFAULT_ENVELOPE_KDF: EnvelopeKDFParams = {
  algo: "argon2id",
  time: 3,
  mem: 65536,
  parallelism: 1,
  hashLen: 32,
};

export type KeyEnvelope = {
  type: "master";
  version: number;
  salt: string; // base64
  data: string; // base64
  kdfParams: string; // JSON-encoded EnvelopeKDFParams
};

const kdfParamsToArgonType = (algo: EnvelopeKDFParams["algo"]): number => {
  switch (algo) {
    case "argon2d":
      return ArgonType.Argon2d;
    case "argon2i":
      return ArgonType.Argon2i;
    default:
      return ArgonType.Argon2id;
  }
};

const argon2Hash = async (
  password: string,
  salt: Uint8Array,
  params: {
    time: number;
    mem: number;
    hashLen: number;
    parallelism: number;
    type: number;
  },
): Promise<Uint8Array> => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker/argon.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (e) => {
      if (e.data.error) {
        reject(new Error(e.data.error));
      } else {
        resolve(new Uint8Array(e.data.hash));
      }
      worker.terminate();
    };

    worker.postMessage({
      password,
      salt: Array.from(salt),
      ...params,
    });
  });
};

export const deriveBucketKeyFromMaster = async (
  masterKeyRaw: Uint8Array,
  exportable: boolean = false,
): Promise<CryptoKey> => {
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    masterKeyRaw,
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: BUCKET_KEY_INFO,
    },
    hkdfKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    exportable,
    ["sign"],
  );
};

const LEGACY_PIN_KDF: KDFCost = { time: 8, mem: 131072 };
const PIN_KDF: KDFCost = {
  time: DEFAULT_ENVELOPE_KDF.time,
  mem: DEFAULT_ENVELOPE_KDF.mem,
};
const KEYSTORE_PIN_KDF: KDFCost = { time: 2, mem: 16384 };

export const deriveMasterKey = async (
  password: string,
  salt: Uint8Array,
  exportable: boolean = false,
  kdf: KDFCost = DEFAULT_ENVELOPE_KDF,
): Promise<DerivedKeys> => {
  const hash = await argon2Hash(password, salt, {
    time: kdf.time,
    mem: kdf.mem,
    hashLen: 32,
    parallelism: 1,
    type: ArgonType.Argon2id,
  });

  const [masterKey, bucketKey] = await Promise.all([
    crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, exportable, [
      "encrypt",
      "decrypt",
    ]),
    deriveBucketKeyFromMaster(hash, exportable),
  ]);

  return { masterKey, bucketKey };
};

export const generateMasterKeyEnvelope = async (
  password: string,
  exportable: boolean = false,
): Promise<DerivedKeys & { envelope: KeyEnvelope }> => {
  const rawMasterKey = randomBytes(32);

  const [masterKey, bucketKey] = await Promise.all([
    crypto.subtle.importKey(
      "raw",
      rawMasterKey,
      { name: "AES-GCM" },
      exportable,
      ["encrypt", "decrypt"],
    ),
    deriveBucketKeyFromMaster(rawMasterKey, exportable),
  ]);

  const envelope = await wrapMasterKeyBytes(password, rawMasterKey);

  return { masterKey, bucketKey, envelope };
};

export const rewrapMasterKeyEnvelope = async (
  password: string,
  masterKey: CryptoKey,
): Promise<KeyEnvelope> => {
  const rawMasterKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", masterKey),
  );
  return wrapMasterKeyBytes(password, rawMasterKey);
};

const wrapMasterKeyBytes = async (
  password: string,
  rawMasterKey: Uint8Array,
): Promise<KeyEnvelope> => {
  const salt = randomBytes(16);
  const hash = await argon2Hash(password, salt, {
    time: DEFAULT_ENVELOPE_KDF.time,
    mem: DEFAULT_ENVELOPE_KDF.mem,
    hashLen: DEFAULT_ENVELOPE_KDF.hashLen,
    parallelism: DEFAULT_ENVELOPE_KDF.parallelism,
    type: kdfParamsToArgonType(DEFAULT_ENVELOPE_KDF.algo),
  });

  const wrappingKey = await crypto.subtle.importKey(
    "raw",
    hash,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );

  const data = await encrypt(rawMasterKey, wrappingKey);

  return {
    type: "master",
    version: 1,
    salt: arrayBufferToBase64(salt.buffer),
    data: arrayBufferToBase64(data),
    kdfParams: JSON.stringify(DEFAULT_ENVELOPE_KDF),
  };
};

export const unwrapMasterKeyEnvelope = async (
  password: string,
  envelope: KeyEnvelope,
  exportable: boolean = false,
): Promise<DerivedKeys> => {
  const params = JSON.parse(envelope.kdfParams) as EnvelopeKDFParams;
  const salt = uint8ArrayFromBase64(envelope.salt);

  const hash = await argon2Hash(password, salt, {
    time: params.time,
    mem: params.mem,
    hashLen: params.hashLen,
    parallelism: params.parallelism,
    type: kdfParamsToArgonType(params.algo),
  });

  const wrappingKey = await crypto.subtle.importKey(
    "raw",
    hash,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );

  let rawMasterKey: Uint8Array;
  try {
    rawMasterKey = await decrypt(
      uint8ArrayFromBase64(envelope.data),
      wrappingKey,
    );
  } catch {
    throw new Error(t("unlock.invalidPassword"));
  }

  const [masterKey, bucketKey] = await Promise.all([
    crypto.subtle.importKey(
      "raw",
      rawMasterKey,
      { name: "AES-GCM" },
      exportable,
      ["encrypt", "decrypt"],
    ),
    deriveBucketKeyFromMaster(rawMasterKey, exportable),
  ]);

  return { masterKey, bucketKey };
};

export const exportKeyPair = async (
  masterKey: CryptoKey,
  bucketKey: CryptoKey,
) => {
  const [masterKeyRaw, bucketKeyRaw] = await Promise.all([
    crypto.subtle.exportKey("raw", masterKey),
    crypto.subtle.exportKey("raw", bucketKey),
  ]);

  return {
    masterKeyB64: arrayBufferToBase64(masterKeyRaw),
    bucketKeyB64: arrayBufferToBase64(bucketKeyRaw),
  };
};

export const importKeyPair = async (
  masterKeyB64: string,
  bucketKeyB64: string,
) => {
  const [masterKey, bucketKey] = await Promise.all([
    crypto.subtle.importKey(
      "raw",
      uint8ArrayFromBase64(masterKeyB64),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    ),
    crypto.subtle.importKey(
      "raw",
      uint8ArrayFromBase64(bucketKeyB64),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ),
  ]);

  return { masterKey, bucketKey };
};

const parseKeyPayload = (payload: AllowSharedBufferSource) =>
  JSON.parse(new TextDecoder().decode(payload)) as {
    masterKeyB64: string;
    bucketKeyB64: string;
  };

export class KeystoreUnavailableError extends Error {}

const keystoreKey = async (): Promise<CryptoKey> => {
  const bytes = await invoke<number[]>("device_key").catch(() => {
    throw new KeystoreUnavailableError();
  });
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
};

const availableKeystoreKey = async (): Promise<CryptoKey | null> =>
  isTauri ? keystoreKey().catch(() => null) : null;

export const protectUnlockKeys = async (
  keys: DerivedKeys,
): Promise<StoredKeyPair | WrappedUnlockKeys> => {
  const key = await availableKeystoreKey();
  if (!key && !isTauri) return keys;

  const exported = await exportKeyPair(keys.masterKey, keys.bucketKey);
  if (!key) return importKeyPair(exported.masterKeyB64, exported.bucketKeyB64);

  const payload = new TextEncoder().encode(JSON.stringify(exported));
  return { encrypted: arrayBufferToBase64(await encrypt(payload, key)) };
};

export const restoreUnlockKeys = async (
  stored: StoredKeyPair | WrappedUnlockKeys,
): Promise<DerivedKeys> => {
  if (!("encrypted" in stored)) {
    if (!stored.masterKey) throw new Error("invalid stored keys");
    return stored;
  }

  const decrypted = await decrypt(
    uint8ArrayFromBase64(stored.encrypted),
    await keystoreKey(),
  );
  const { masterKeyB64, bucketKeyB64 } = parseKeyPayload(decrypted);
  return importKeyPair(masterKeyB64, bucketKeyB64);
};

export const wrapKeyPairWithPin = async (
  pin: string,
  masterKeyB64: string,
  bucketKeyB64: string,
): Promise<WrappedKeyPair> => {
  const salt = randomBytes(16);
  const key = await availableKeystoreKey();
  const kdf = key ? KEYSTORE_PIN_KDF : PIN_KDF;
  const { masterKey: pinKey } = await deriveMasterKey(pin, salt, false, kdf);

  const payload = new TextEncoder().encode(
    JSON.stringify({ masterKeyB64, bucketKeyB64 }),
  );
  let encrypted = await encrypt(payload, pinKey);
  if (key) encrypted = await encrypt(new Uint8Array(encrypted), key);

  return {
    salt: arrayBufferToBase64(salt.buffer),
    encrypted: arrayBufferToBase64(encrypted),
    kdf,
    ...(key && { keystore: true }),
  };
};

export const unwrapKeyPairWithPin = async (
  pin: string,
  wrapped: WrappedKeyPair,
) => {
  let blob: Uint8Array = uint8ArrayFromBase64(wrapped.encrypted);
  if (wrapped.keystore) {
    const key = await keystoreKey();
    blob = await decrypt(blob, key).catch(() => {
      throw new KeystoreUnavailableError();
    });
  }
  const { masterKey: pinKey } = await deriveMasterKey(
    pin,
    uint8ArrayFromBase64(wrapped.salt),
    false,
    wrapped.kdf ?? LEGACY_PIN_KDF,
  );
  const decrypted = await decrypt(blob, pinKey);
  const { masterKeyB64, bucketKeyB64 } = parseKeyPayload(decrypted);
  const keys = await importKeyPair(masterKeyB64, bucketKeyB64);
  const upgraded =
    isTauri && !wrapped.keystore
      ? await wrapKeyPairWithPin(pin, masterKeyB64, bucketKeyB64).catch(
          () => null,
        )
      : null;

  return { ...keys, upgraded: upgraded?.keystore ? upgraded : null };
};

export const hmacSign = async (
  key: CryptoKey,
  data: string,
): Promise<ArrayBuffer> => {
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
};

export const randomBytes = (len: number): Uint8Array => {
  return crypto.getRandomValues(new Uint8Array(len));
};

export const encrypt = async (
  payload: Uint8Array,
  key: CryptoKey,
): Promise<Encrypted> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new Uint8Array(payload),
    ),
  );

  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);

  return combined.buffer;
};

export const decrypt = async (
  data: Encrypted | Uint8Array,
  key: CryptoKey,
): Promise<Uint8Array> => {
  const bytes = new Uint8Array(data);

  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return new Uint8Array(plaintext);
};

export async function generateSRPTriplet(
  email: string,
  password: string,
  salt: Uint8Array = generateSalt(),
  params: Params = SRP_PARAMS,
): Promise<Triplet> {
  return await Triplet.create(params, email, password, salt);
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

function padUint8(arr: Uint8Array, length: number): Uint8Array {
  if (arr.length >= length) return arr;
  const padded = new Uint8Array(length);
  padded.set(arr, length - arr.length);
  return padded;
}

function bigintToUint8Array(value: bigint, length?: number): Uint8Array {
  if (value === 0n) return new Uint8Array(length ?? 1).fill(0);

  const reversed: number[] = [];
  let temp = value;
  while (temp > 0) {
    reversed.push(Number(temp & 0xffn));
    temp >>= 8n;
  }
  const bytes = reversed.toReversed();

  if (length !== undefined) {
    if (bytes.length > length) {
      throw new Error("bigint too large to fit in the target length");
    }
    const padded = new Uint8Array(length);
    padded.set(bytes, length - bytes.length);
    return padded;
  }

  return new Uint8Array(bytes);
}

export function SRP_CheckM2(
  expected: bigint,
  received: Uint8Array,
  bitLen: number,
) {
  const left = padUint8(bigintToUint8Array(expected), Math.ceil(bitLen / 8));
  const right = padUint8(received, Math.ceil(bitLen / 8));
  return timingSafeEqual(left, right);
}

function leadingZeroBits(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      count += 8;
      continue;
    }
    count += Math.clz32(byte) - 24;
    break;
  }
  return count;
}

export async function solveProofOfWork(
  token: string,
  difficultyBits: number,
): Promise<string> {
  const [payload] = token.split(".");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(
    base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="),
  );
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const { seed, email } = JSON.parse(new TextDecoder().decode(bytes)) as {
    seed: string;
    email: string;
  };

  const enc = new TextEncoder();
  for (let nonce = 0; ; nonce++) {
    const nonceStr = nonce.toString();
    const hash = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        enc.encode(`${seed}|${email}|${nonceStr}`),
      ),
    );
    if (leadingZeroBits(hash) >= difficultyBits) {
      return nonceStr;
    }
  }
}

export const encryptJson = async (
  value: unknown,
  key: CryptoKey,
): Promise<Encrypted> => {
  const payload = new TextEncoder().encode(JSON.stringify(value));
  return encrypt(await compress(payload), key);
};

export const decryptJson = async <T>(
  data: Encrypted | Uint8Array,
  key: CryptoKey,
): Promise<T> => {
  const decompressed = await decompress(await decrypt(data, key));
  return JSON.parse(new TextDecoder().decode(decompressed));
};
