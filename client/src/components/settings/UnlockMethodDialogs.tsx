import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MAX_PASSWORD_LENGTH } from "@/lib/crypt";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";

export function PinSetupDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (pin: string, currentPassword: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setPin("");
      setConfirmPin("");
      setCurrentPassword("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!/^\d{4,16}$/.test(pin)) {
      setError(t("settings.pin.length"));
      return;
    }
    if (pin !== confirmPin) {
      setError(t("settings.pin.mismatch"));
      return;
    }
    if (!currentPassword) {
      setError(t("settings.enterCurrentPassword"));
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(pin, currentPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.pin.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("settings.pin.setupTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="pin-setup-pin">
              {t("settings.pin.pin")}
            </FieldLabel>
            <Input
              id="pin-setup-pin"
              type="password"
              inputMode="numeric"
              maxLength={16}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pin-setup-confirm">
              {t("settings.pin.confirm")}
            </FieldLabel>
            <Input
              id="pin-setup-confirm"
              type="password"
              inputMode="numeric"
              maxLength={16}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pin-setup-password">
              {t("settings.currentPassword")}
            </FieldLabel>
            <Input
              id="pin-setup-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </Field>
          {error && <span className="text-sm text-destructive">{error}</span>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2 className="animate-spin" />
              ) : (
                t("settings.pin.set")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StayUnlockedDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (currentPassword: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setCurrentPassword("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentPassword) {
      setError(t("settings.enterCurrentPassword"));
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(currentPassword);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("settings.stayUnlocked.failed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.stayUnlocked.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.stayUnlocked.description")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="stay-unlocked-password">
              {t("settings.currentPassword")}
            </FieldLabel>
            <Input
              id="stay-unlocked-password"
              type="password"
              maxLength={MAX_PASSWORD_LENGTH}
              autoFocus
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </Field>
          {error && <span className="text-sm text-destructive">{error}</span>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2 className="animate-spin" />
              ) : (
                t("settings.stayUnlocked.enable")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
