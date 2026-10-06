import {
  unwrapMasterKeyEnvelope,
  type DerivedKeys,
  type KeyEnvelope,
} from "@/lib/crypt";
import { t } from "@/i18n";

export async function unlockAccount(
  password: string,
  user: { envelopes: KeyEnvelope[] },
  exportable: boolean = false,
): Promise<DerivedKeys> {
  const masterEnvelope = user.envelopes.find((e) => e.type === "master");
  if (!masterEnvelope) throw new Error(t("unlock.invalidPassword"));

  return unwrapMasterKeyEnvelope(password, masterEnvelope, exportable);
}
