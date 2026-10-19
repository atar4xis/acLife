import { decryptJson, encryptJson, GCM_TAG_BYTES, IV_BYTES } from "@/lib/crypt";
import { compress } from "@/lib/gzip";
import { DEFAULT_JOURNAL } from "@/lib/journal/item";
import {
  arrayBufferToBase64,
  uint8ArrayFromBase64,
  withoutRuntimeFields,
} from "@/lib/utils";
import type { Encrypted } from "@/types/Crypt";
import type { JournalData, JournalItem } from "@/types/Journal";
import type { EncryptedRecord } from "@/types/Sync";

export const MAX_ENCRYPTED_JOURNAL_BYTES = 256 << 10;

export const fitsUpload = async (item: JournalItem) => {
  const json = new TextEncoder().encode(JSON.stringify(item));
  const compressed = await compress(json);

  return (
    compressed.length + IV_BYTES + GCM_TAG_BYTES <= MAX_ENCRYPTED_JOURNAL_BYTES
  );
};

export const decryptJournal = async (
  data: Encrypted,
  masterKey: CryptoKey,
) => ({
  ...DEFAULT_JOURNAL,
  ...(await decryptJson<JournalData>(data, masterKey)),
});

export const encryptItem = async (
  item: JournalItem,
  masterKey: CryptoKey,
): Promise<EncryptedRecord> => ({
  id: item.id,
  updatedAt: item.updatedAt,
  data: arrayBufferToBase64(
    await encryptJson(withoutRuntimeFields(item), masterKey),
  ),
});

export const decryptItem = async (
  record: EncryptedRecord,
  masterKey: CryptoKey,
): Promise<JournalItem | null> => {
  try {
    const item = await decryptJson<JournalItem>(
      uint8ArrayFromBase64(record.data),
      masterKey,
    );
    if (item.id.toLowerCase() !== record.id.toLowerCase()) return null;

    return { ...withoutRuntimeFields(item), updatedAt: record.updatedAt };
  } catch {
    return null;
  }
};
