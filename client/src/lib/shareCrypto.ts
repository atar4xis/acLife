import { decrypt, encrypt } from "@/lib/crypt";
import { arrayBufferToBase64, uint8ArrayFromBase64 } from "@/lib/utils";

const CURVE = { name: "ECDH", namedCurve: "P-256" } as const;
const WRAP_INFO = new TextEncoder().encode("acLife-share-key-v1");
const DATA_INFO = new TextEncoder().encode("acLife-share-data-v1");
const BUCKET_INFO = new TextEncoder().encode("acLife-share-bucket-v1");

const SPACE_KEY_BYTES = 32;
const FINGERPRINT_GROUPS = 6;

type KeyPair = {
  publicKey: Uint8Array<ArrayBuffer>;
  privateKey: CryptoKey;
};

export type SpaceKeys = {
  key: CryptoKey;
  bucketKey: CryptoKey;
};

export const generateKeyPair = async (): Promise<KeyPair> => {
  const pair = await crypto.subtle.generateKey(CURVE, true, ["deriveBits"]);
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  return { publicKey, privateKey: pair.privateKey };
};

export const wrapPrivateKey = async (
  privateKey: CryptoKey,
  masterKey: CryptoKey,
) => {
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", privateKey),
  );
  return arrayBufferToBase64(await encrypt(pkcs8, masterKey));
};

export const unwrapPrivateKey = async (
  wrapped: string,
  masterKey: CryptoKey,
) => {
  const pkcs8 = await decrypt(uint8ArrayFromBase64(wrapped), masterKey);
  return crypto.subtle.importKey("pkcs8", pkcs8, CURVE, false, ["deriveBits"]);
};

const importPublicKey = (raw: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey("raw", raw, CURVE, false, []);

const deriveWrapKey = async (
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  space: string,
) => {
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    256,
  );
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);
  const info = new Uint8Array([
    ...WRAP_INFO,
    ...new TextEncoder().encode(space),
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

export const generateSpaceKey = () =>
  crypto.getRandomValues(new Uint8Array(SPACE_KEY_BYTES));

export const wrapSpaceKeyForOwner = async (
  raw: Uint8Array,
  masterKey: CryptoKey,
) => arrayBufferToBase64(await encrypt(raw, masterKey));

export const unwrapSpaceKeyForOwner = async (
  wrapped: string,
  masterKey: CryptoKey,
) => new Uint8Array(await decrypt(uint8ArrayFromBase64(wrapped), masterKey));

export const wrapSpaceKey = async (
  raw: Uint8Array,
  ownerPrivateKey: CryptoKey,
  recipientPublicKey: string,
  space: string,
) => {
  const recipient = await importPublicKey(
    uint8ArrayFromBase64(recipientPublicKey),
  );
  const wrapKey = await deriveWrapKey(ownerPrivateKey, recipient, space);
  return arrayBufferToBase64(await encrypt(raw, wrapKey));
};

export const unwrapSpaceKey = async (
  wrapped: string,
  recipientPrivateKey: CryptoKey,
  ownerPublicKey: string,
  space: string,
): Promise<Uint8Array<ArrayBuffer>> => {
  const owner = await importPublicKey(uint8ArrayFromBase64(ownerPublicKey));
  const wrapKey = await deriveWrapKey(recipientPrivateKey, owner, space);
  return new Uint8Array(await decrypt(uint8ArrayFromBase64(wrapped), wrapKey));
};

export const deriveSpaceKeys = async (
  raw: Uint8Array<ArrayBuffer>,
): Promise<SpaceKeys> => {
  const hkdf = await crypto.subtle.importKey("raw", raw, "HKDF", false, [
    "deriveKey",
  ]);
  const derive = (
    info: Uint8Array,
    algorithm: AesDerivedKeyParams | HmacImportParams,
    usages: KeyUsage[],
  ) =>
    crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info },
      hkdf,
      algorithm,
      false,
      usages,
    );

  const [key, bucketKey] = await Promise.all([
    derive(DATA_INFO, { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
    derive(BUCKET_INFO, { name: "HMAC", hash: "SHA-256", length: 256 }, [
      "sign",
    ]),
  ]);
  return { key, bucketKey };
};

// short code both people compare out of band to catch a swapped public key
export const fingerprint = async (publicKey: string) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", uint8ArrayFromBase64(publicKey)),
  );
  return Array.from({ length: FINGERPRINT_GROUPS }, (_, i) =>
    ((digest[2 * i] << 8) | digest[2 * i + 1]).toString().padStart(5, "0"),
  ).join(" ");
};
