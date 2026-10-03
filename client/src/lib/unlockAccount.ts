import { toast } from "sonner";
import {
  unlockMasterKey,
  unwrapMasterKeyEnvelope,
  type DerivedKeys,
  type KeyEnvelope,
} from "@/lib/crypt";
import {
  migrateToKeyEnvelope,
  type ApiPost,
  type CacheStorage,
} from "@/lib/calendar/crypt";
import { uint8ArrayFromBase64 } from "@/lib/utils";
import { t } from "@/i18n";

type UnlockableUser = {
  envelopes: KeyEnvelope[];
  salt: string | null;
  challenge: string | null;
};

export async function unlockAccount(
  password: string,
  user: UnlockableUser,
  post: ApiPost,
  storage?: CacheStorage,
  exportable: boolean = false,
): Promise<DerivedKeys> {
  const masterEnvelope = user.envelopes.find((e) => e.type === "master");

  if (masterEnvelope) {
    return unwrapMasterKeyEnvelope(password, masterEnvelope, exportable);
  }

  if (!user.salt || !user.challenge) {
    throw new Error(t("unlock.invalidPassword"));
  }

  // legacy account, unlock the old way, then silently upgrade
  const salt = uint8ArrayFromBase64(user.salt);
  const encryptedChallenge = uint8ArrayFromBase64(atob(user.challenge));
  const { masterKey, bucketKey } = await unlockMasterKey(
    password,
    salt,
    encryptedChallenge,
    exportable,
  );

  try {
    const upgraded = await migrateToKeyEnvelope(
      password,
      masterKey,
      post,
      storage,
      exportable,
    );
    toast.success(t("unlock.upgraded"));
    return upgraded;
  } catch (err) {
    console.error("Envelope migration failed:", err);
    // keep using the old (legacy) key pair - migration can retry next login
    return { masterKey, bucketKey };
  }
}
