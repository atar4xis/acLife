import type { ServerMetadata } from "@/types/ServerMetadata";

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateServerMeta(data: any): data is ServerMetadata {
  // ensure data is an object
  if (typeof data !== "object" || data === null) return false;

  // validate server url exists and is valid
  if (typeof data.url !== "string" || !isValidUrl(data.url)) return false;

  // validate policies if present
  if (data.policies !== undefined) {
    if (typeof data.policies !== "object" || data.policies === null)
      return false;

    // privacy policy url
    if (
      data.policies.privacy !== undefined &&
      (typeof data.policies.privacy !== "string" ||
        !isValidUrl(data.policies.privacy))
    )
      return false;

    // terms of service url
    if (
      data.policies.terms !== undefined &&
      (typeof data.policies.terms !== "string" ||
        !isValidUrl(data.policies.terms))
    )
      return false;

    // check for extra keys in policies
    const policyKeys = Object.keys(data.policies);
    if (!policyKeys.every((k) => ["privacy", "terms"].includes(k)))
      return false;
  }

  // validate registration exists and is an object
  if (typeof data.registration !== "object" || data.registration === null)
    return false;

  // validate registration.enabled
  if (typeof data.registration.enabled !== "boolean") return false;

  // validate registration.email if present
  if (data.registration.email !== undefined) {
    const email = data.registration.email;

    if (typeof email !== "object" || email === null) return false;
    if (typeof email.verificationRequired !== "boolean") return false;
    if (!Array.isArray(email.domainBlacklist)) return false;
    if (!email.domainBlacklist.every((d: unknown) => typeof d === "string"))
      return false;

    // check for extra keys in email
    const emailKeys = Object.keys(email);
    if (
      !emailKeys.every((k) =>
        ["verificationRequired", "domainBlacklist"].includes(k),
      )
    )
      return false;
  }

  // validate registration.retentionPeriod if present
  if (
    data.registration.retentionPeriod !== undefined &&
    typeof data.registration.retentionPeriod !== "number"
  )
    return false;

  // check for extra keys in registration
  const registrationKeys = Object.keys(data.registration);
  if (
    !registrationKeys.every((k) =>
      ["enabled", "subscriptionRequired", "email", "retentionPeriod"].includes(
        k,
      ),
    )
  )
    return false;

  // check for extra keys in top-level data
  const topKeys = Object.keys(data);
  if (!topKeys.every((k) => ["url", "policies", "registration"].includes(k)))
    return false;

  return true;
}

export function validatePassword(password: string): boolean {
  if (!password) return false;

  const lengthValid = password.length >= 12 && password.length <= 256;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>_\-\\[\];'`~\/+=]/.test(password);

  return lengthValid && hasUppercase && hasLowercase && hasDigit && hasSpecial;
}
