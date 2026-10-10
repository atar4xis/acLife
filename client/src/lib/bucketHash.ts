import type { CachedRecord } from "@/types/Sync";
import { arrayBufferToBase64 } from "./utils";

export const computeBucketHash = async (
  records: CachedRecord[],
): Promise<string> => {
  const lines = records
    .map((record) => `${record.id.toLowerCase()}:${record.ts}`)
    .toSorted();
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(lines.join("\n")),
  );
  return arrayBufferToBase64(hash);
};
