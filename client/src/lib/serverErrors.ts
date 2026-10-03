import { t } from "@/i18n";
import type { APIResponse } from "@/types/API";

export function localizeReply<T>(result: APIResponse<T>): APIResponse<T> {
  if (result.code) {
    result.message = t(`serverErrors.${result.code}`, {
      ...result.params,
      defaultValue: result.message,
    });
  }
  return result;
}
