import { useShares } from "@/context/ShareContext";
import type { Candidate, Contact } from "@/types/Share";
import { useState, type SubmitEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export function useFindContact({
  onTrusted,
  validate,
}: {
  onTrusted: (contact: Contact) => Promise<void> | void;
  validate?: (email: string) => string | undefined;
}) {
  const { t } = useTranslation();
  const { lookupContact, trustOf } = useShares();
  const [email, setEmail] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [error, setError] = useState("");
  const [finding, setFinding] = useState(false);

  const reset = () => {
    setEmail("");
    setError("");
    setCandidate(null);
  };

  const findContact = async (typedEmail: string) => {
    setFinding(true);
    setError("");
    let found;
    try {
      found = await lookupContact(typedEmail);
    } catch {
      toast.error(t("serverErrors.internal_error"));
    } finally {
      setFinding(false);
    }

    if (found === undefined) return;
    if (found === "self") {
      setError(t("shares.enterOtherEmail"));
      return;
    }
    if (!found) {
      setError(t("shares.userNotFound"));
      return;
    }

    return { contact: found, trust: trustOf(found) };
  };

  const submitEmail = async (e: SubmitEvent) => {
    e.preventDefault();
    const typedEmail = email.trim();
    if (!typedEmail) return;

    const validationError = validate?.(typedEmail);
    if (validationError) {
      setError(validationError);
      return;
    }

    const found = await findContact(typedEmail);
    if (!found) return;

    // a new or changed key needs the user to confirm the fingerprint first
    if (found.trust === "same") await onTrusted(found.contact);
    else setCandidate(found);
  };

  return {
    email,
    setEmail,
    candidate,
    setCandidate,
    error,
    finding,
    submitEmail,
    reset,
  };
}
