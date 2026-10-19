import FingerprintStep from "@/components/sharing/FingerprintStep";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useShares } from "@/context/ShareContext";
import { useFindContact } from "@/hooks/useFindContact";
import type { Contact } from "@/types/Share";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export default function AddContactDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { pinContact } = useShares();
  const add = (contact: Contact) => {
    pinContact(contact);
    toast.success(t("shares.contactAdded"));
    close();
  };
  const {
    email,
    setEmail,
    candidate,
    setCandidate,
    error,
    finding,
    submitEmail,
    reset,
  } = useFindContact({ onTrusted: add });

  const close = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("shares.addContact")}</DialogTitle>
        </DialogHeader>

        {candidate ? (
          <FingerprintStep
            email={candidate.contact.email}
            publicKey={candidate.contact.publicKey}
            trust={candidate.trust}
            continueLabel={t("shares.addContact")}
            onContinue={() => add(candidate.contact)}
            onCancel={() => setCandidate(null)}
          />
        ) : (
          <form onSubmit={submitEmail} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="contact-email">
                {t("shares.email")}
              </FieldLabel>
              <Input
                id="contact-email"
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={finding || !email.trim()}>
                {t("shares.continue")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
