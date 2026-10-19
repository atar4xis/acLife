import FingerprintStep from "@/components/sharing/FingerprintStep";
import ContactCard from "@/components/sharing/ContactCard";
import MemberList from "@/components/sharing/MemberList";
import PermissionSelect from "@/components/sharing/PermissionSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import ScrollContainer from "@/components/ui/scroll-container";
import { useShares } from "@/context/ShareContext";
import { useFindContact } from "@/hooks/useFindContact";
import type { Contact, Permission } from "@/types/Share";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export default function ShareDialog() {
  const { t } = useTranslation();
  const {
    shareRequest: request,
    openShare,
    closeShare,
    owned,
    contacts,
    createShare,
    addMember,
  } = useShares();
  const [permission, setNewPermission] = useState<Permission>("read");
  const [busy, setBusy] = useState(false);
  const prepared = useRef<string>(undefined);

  const space = request
    ? owned.find(
        (s) =>
          s.kind === request.kind &&
          s.scope === request.scope &&
          s.target === request.target,
      )
    : undefined;

  const alreadyMember = (email: string) =>
    space?.members.some((m) => m.email.toLowerCase() === email.toLowerCase())
      ? t("shares.alreadyMember")
      : undefined;

  const {
    email,
    setEmail,
    candidate,
    setCandidate,
    error,
    finding,
    submitEmail,
    reset: resetContact,
  } = useFindContact({
    onTrusted: (contact) => share(contact),
    validate: alreadyMember,
  });

  const reset = () => {
    resetContact();
    setNewPermission("read");
  };

  const close = () => {
    prepared.current = undefined;
    reset();
    closeShare();
  };

  const share = async (contact: Contact) => {
    if (!request) return;

    setBusy(true);
    let target: string | null = null;
    let done = false;
    try {
      // a target created on demand is kept so a retry does not create it twice
      target =
        typeof request.target === "function"
          ? (prepared.current ??= request.target())
          : request.target;

      done = space
        ? await addMember(space, contact, permission)
        : !!(await createShare({ ...request, target, contact, permission }));
    } catch {
      toast.error(t("serverErrors.internal_error"));
    } finally {
      setBusy(false);
    }

    if (!done) {
      setCandidate(null);
      return;
    }
    toast.success(t("shares.invited"));
    reset();
    if (typeof request.target === "function") openShare({ ...request, target });
  };

  const suggestions = contacts.filter(
    (contact) => !space?.members.some((m) => m.user === contact.uuid),
  );

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && close()}>
      <DialogContent className="grid-cols-1">
        <DialogHeader className="gap-4">
          <DialogTitle className="wrap-break-word">
            {t("shares.title", { label: request?.label })}
          </DialogTitle>
          <DialogDescription>
            {t(
              request?.scope === "item"
                ? "shares.descriptionItem"
                : "shares.descriptionCollection",
            )}
          </DialogDescription>
        </DialogHeader>

        {candidate ? (
          <FingerprintStep
            email={candidate.contact.email}
            publicKey={candidate.contact.publicKey}
            trust={candidate.trust}
            continueLabel={t("shares.sendInvite")}
            busy={busy}
            onContinue={() => share(candidate.contact)}
            onCancel={() => setCandidate(null)}
          />
        ) : (
          <form onSubmit={submitEmail} className="flex flex-col gap-4">
            {suggestions.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-sm font-medium">
                  {t("shares.contacts")}
                </span>
                <ScrollContainer className="max-h-32">
                  <ul className="flex flex-col">
                    {suggestions.map((contact) => (
                      <li key={contact.uuid}>
                        <Button
                          type="button"
                          variant="ghost"
                          className="w-full justify-start"
                          onClick={() => setEmail(contact.email)}
                        >
                          <ContactCard mini contact={contact} />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </ScrollContainer>
              </div>
            )}
            <Field>
              <FieldLabel htmlFor="share-email">{t("shares.email")}</FieldLabel>
              <Input
                id="share-email"
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PermissionSelect
                value={permission}
                onChange={setNewPermission}
                label={t("shares.permission")}
              />
              <Button type="submit" disabled={busy || finding || !email.trim()}>
                {t("shares.continue")}
              </Button>
            </div>
          </form>
        )}

        {space && !candidate && (
          <div className="flex flex-col gap-2">
            {space.members.length > 0 && (
              <h3 className="text-muted-foreground text-sm font-medium">
                {t("shares.people")}
              </h3>
            )}
            <MemberList space={space} className="flex flex-col gap-2" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
