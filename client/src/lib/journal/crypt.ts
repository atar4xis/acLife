import { decryptJson, encryptJson } from "@/lib/crypt";
import { DEFAULT_JOURNAL } from "@/lib/journal/item";
import { arrayBufferToBase64, uint8ArrayFromBase64 } from "@/lib/utils";
import type { Encrypted } from "@/types/Crypt";
import type { JournalData, JournalItem } from "@/types/Journal";
import type { EncryptedRecord } from "@/types/Sync";

export const MAX_ENCRYPTED_JOURNAL_BYTES = 256 << 10;

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
  data: arrayBufferToBase64(await encryptJson(item, masterKey)),
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
    return item.id.toLowerCase() === record.id.toLowerCase()
      ? { ...item, updatedAt: record.updatedAt }
      : null;
  } catch {
    return null;
  }
};
