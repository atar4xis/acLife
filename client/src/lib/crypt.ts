import type { Encrypted } from "@/types/Crypt";
import {
  RFC5054Group4096,
  Triplet,
  concatUint8Array,
  generateSalt,
  type Params,
} from "@mzattahri/srp";

export const SRP_PARAMS: Params = {
  name: "DH16-SHA256-CustomKDF",
  group: RFC5054Group4096,
  hash: async (...inputs: Uint8Array[]) => {
    const data = concatUint8Array(...inputs);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  },
  kdf: async (username: string, password: string, salt: Uint8Array) => {
    const enc = new TextEncoder();
    const inner = await crypto.subtle.digest(
      "SHA-256",
      concatUint8Array(
        enc.encode(username),
        enc.encode(":"),
        enc.encode(password),
      ),
    );
    return new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        concatUint8Array(salt, new Uint8Array(inner)),
      ),
    );
  },
};

export const UNLOCK_CHECK_BYTES = new Uint8Array([
  117, 110, 108, 111, 99, 107, 45, 99, 104, 101, 99, 107, 45, 111, 107, 33,
]);

export const deriveMasterKey = async (
  password: string,
  salt: Uint8Array,
  exportable: boolean = false,
): Promise<CryptoKey> => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker/argon.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = async (e) => {
      if (e.data.error) {
        reject(new Error(e.data.error));
      } else {
        const hash = new Uint8Array(e.data.hash);
        const key = await crypto.subtle.importKey(
          "raw",
          hash,
          { name: "AES-GCM" },
          exportable,
          ["encrypt", "decrypt"],
        );
        resolve(key);
      }
      worker.terminate();
    };

    worker.postMessage({
      password,
      salt: Array.from(salt),
      time: 3,
      mem: 65536,
      hashLen: 32,
      parallelism: 1,
    });
  });
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
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload),
  );

  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);

  return combined.buffer;
};

export const decrypt = async (
  data: Encrypted,
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
): Promise<Triplet> {
  const salt = generateSalt();
  return await Triplet.create(SRP_PARAMS, email, password, salt);
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

  const bytes: number[] = [];
  let temp = value;
  while (temp > 0) {
    bytes.push(Number(temp & 0xffn));
    temp >>= 8n;
  }
  bytes.reverse();

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
