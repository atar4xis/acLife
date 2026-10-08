import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useApi } from "@/context/ApiContext";
import { useSessions } from "@/hooks/useSessions";
import {
  SecuritySettingsProvider,
  useSecuritySettings,
} from "@/context/SecuritySettingsContext";
import {
  generateSRPTriplet,
  MAX_PASSWORD_LENGTH,
  rewrapMasterKeyEnvelope,
} from "@/lib/crypt";
import { unlockAccount } from "@/lib/unlockAccount";
import { postWithPassword } from "@/lib/srpLogin";
import { validatePassword } from "@/lib/validators";
import { bytesToBase64 } from "@/lib/utils";
import type { AutoLockOption, UnlockMethod } from "@/types/Storage";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectItem } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { sectionLabel, settingLabel, settingLabelId } from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import Section from "../SettingsSection";
import SettingsLabel from "../SettingsLabel";
import SettingsSelect from "../SettingsSelect";
import UsageField from "./UsageField";
import { useTranslation } from "react-i18next";

function ChangeEmailDialog({
  open,
  currentEmail,
  verificationRequired,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  currentEmail: string;
  verificationRequired: boolean;
  onCancel: () => void;
  onConfirm: (newEmail: string, currentPassword: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setNewEmail("");
      setPassword("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newEmail || !password) {
      setError(t("login.fillAll"));
      return;
    }
    if (newEmail === currentEmail) {
      setError(t("settings.security.sameEmail"));
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(newEmail, password);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("settings.security.emailFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.security.changeEmail")}</DialogTitle>
          <DialogDescription>
            {verificationRequired ? t("settings.security.verifyWarning") : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="new-email">
              {t("settings.security.newEmail")}
            </FieldLabel>
            <Input
              id="new-email"
              type="email"
              autoFocus
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="current-password-email">
              {t("settings.currentPassword")}
            </FieldLabel>
            <Input
              id="current-password-email"
              type="password"
              maxLength={MAX_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
                t("common.save")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t("login.fillAll"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("login.passwordsMismatch"));
      return;
    }
    if (!validatePassword(newPassword)) {
      setError(t("settings.security.passwordRules"));
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(currentPassword, newPassword);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("settings.security.passwordFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("settings.security.changePassword")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="current-password">
              {t("settings.currentPassword")}
            </FieldLabel>
            <Input
              id="current-password"
              type="password"
              maxLength={MAX_PASSWORD_LENGTH}
              autoFocus
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-password">
              {t("settings.security.newPassword")}
            </FieldLabel>
            <Input
              id="new-password"
              type="password"
              maxLength={MAX_PASSWORD_LENGTH}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-new-password">
              {t("settings.security.confirmNewPassword")}
            </FieldLabel>
            <Input
              id="confirm-new-password"
              type="password"
              maxLength={MAX_PASSWORD_LENGTH}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
                t("common.save")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountSection({
  sectionRefs,
  onPasswordChanged,
}: {
  sectionRefs: SectionRefs;
  onPasswordChanged: () => void;
}) {
  const { t } = useTranslation();
  const { user, masterKey, checkLogin } = useUser();
  const { post, serverMeta } = useApi();
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  if (!user || user.type !== "online") return null;

  const handleEmailChange = async (
    newEmail: string,
    currentPassword: string,
  ) => {
    const triplet = await generateSRPTriplet(newEmail, currentPassword);

    const res = await postWithPassword<{
      email: string;
      requiresVerification: boolean;
    }>(post, user.email, currentPassword, "user/email", {
      triplet: bytesToBase64(triplet.toUint8Array()),
    });

    if (res.data?.requiresVerification) {
      setEmailDialogOpen(false);
      toast.success(t("settings.security.emailUpdatedVerify"));
      return;
    }

    if (!res.success) {
      throw new Error(res.message || t("settings.security.emailFailed"));
    }

    await checkLogin();
    setEmailDialogOpen(false);
    toast.success(t("settings.security.emailUpdated"));
  };

  const handlePasswordChange = async (
    currentPassword: string,
    newPassword: string,
  ) => {
    if (!masterKey) {
      throw new Error(t("settings.security.mustDecrypt"));
    }

    // re-derive an exportable copy of the master key
    const [{ masterKey: verifiedMasterKey }, triplet] = await Promise.all([
      unlockAccount(currentPassword, user, true),
      generateSRPTriplet(user.email, newPassword),
    ]);

    const envelope = await rewrapMasterKeyEnvelope(
      newPassword,
      verifiedMasterKey,
    );

    const res = await postWithPassword<never>(
      post,
      user.email,
      currentPassword,
      "user/password",
      {
        triplet: bytesToBase64(triplet.toUint8Array()),
        envelopes: [envelope],
      },
    );

    if (!res.success) {
      throw new Error(res.message || t("settings.security.passwordFailed"));
    }

    await checkLogin();
    setPasswordDialogOpen(false);
    onPasswordChanged();
    toast.success(t("settings.security.passwordUpdated"));
  };

  return (
    <>
      <Section
        id="account"
        label={sectionLabel("account")}
        sectionRefs={sectionRefs}
      >
        <Field orientation="responsive">
          <div className="flex flex-auto flex-col gap-1">
            <FieldTitle>{settingLabel("account-email")}</FieldTitle>
            <FieldDescription>{user.email}</FieldDescription>
          </div>
          <Button variant="outline" onClick={() => setEmailDialogOpen(true)}>
            {t("settings.security.changeEmail")}
          </Button>
        </Field>

        <Field orientation="responsive">
          <div className="flex flex-auto items-center gap-1.5">
            <FieldTitle>{settingLabel("account-password")}</FieldTitle>
          </div>
          <Button variant="outline" onClick={() => setPasswordDialogOpen(true)}>
            {t("settings.security.changePassword")}
          </Button>
        </Field>

        <UsageField />
      </Section>

      <ChangeEmailDialog
        open={emailDialogOpen}
        currentEmail={user.email}
        verificationRequired={
          serverMeta?.registration.email?.verificationRequired ?? false
        }
        onCancel={() => setEmailDialogOpen(false)}
        onConfirm={handleEmailChange}
      />
      <ChangePasswordDialog
        open={passwordDialogOpen}
        onCancel={() => setPasswordDialogOpen(false)}
        onConfirm={handlePasswordChange}
      />
    </>
  );
}

function SessionsSection({
  sectionRefs,
  sessions,
  setSessions,
  refreshing,
  load,
}: { sectionRefs: SectionRefs } & ReturnType<typeof useSessions>) {
  const { t } = useTranslation();
  const { del } = useApi();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const revoke = async (id: string) => {
    setRevokingId(id);
    const res = await del<never>(`user/sessions/${id}`);
    setRevokingId(null);

    if (!res.success) {
      toast.error(res.message || t("settings.security.endFailed"));
      return;
    }

    setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null);
  };

  return (
    <Section
      id="sessions"
      label={sectionLabel("sessions")}
      sectionRefs={sectionRefs}
      action={
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t("settings.security.refreshSessions")}
          disabled={refreshing}
          onClick={load}
        >
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
        </Button>
      }
    >
      {sessions === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : sessions.length === 0 ? (
        <FieldDescription>{t("settings.security.noSessions")}</FieldDescription>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((s, index) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-4 rounded-md border p-3"
            >
              <div className="flex flex-col gap-1">
                <FieldTitle>
                  {t("settings.security.session", {
                    number: sessions.length - index,
                  })}{" "}
                  {s.current && (
                    <span className="text-xs px-2 bg-accent rounded-md">
                      {t("settings.security.current")}
                    </span>
                  )}
                </FieldTitle>
                <FieldDescription>
                  {t("settings.security.loggedIn", {
                    when: DateTime.fromISO(s.createdAt).toRelative(),
                  })}
                  {" - "}
                  {t("settings.security.expires", {
                    when: DateTime.fromISO(s.expiresAt).toRelative(),
                  })}
                </FieldDescription>
              </div>
              {!s.current && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revokingId === s.id}
                  onClick={() => revoke(s.id)}
                >
                  {t("settings.security.endSession")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function SecurityPageContent({ sectionRefs }: { sectionRefs: SectionRefs }) {
  const { t } = useTranslation();
  const { unlockMethod, autoLock, setUnlockMethod, setAutoLock } =
    useSecuritySettings();
  const sessions = useSessions();

  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">
        {t("settings.categories.security")}
      </h2>

      <AccountSection
        sectionRefs={sectionRefs}
        onPasswordChanged={sessions.load}
      />

      <Separator />

      <Section
        id="encryption"
        label={sectionLabel("encryption")}
        sectionRefs={sectionRefs}
      >
        <Field orientation="responsive">
          <SettingsLabel settingKey="unlockMethod" />
          <SettingsSelect
            labelledBy={settingLabelId("unlockMethod")}
            value={unlockMethod}
            onValueChange={(value) => setUnlockMethod(value as UnlockMethod)}
            footer={
              unlockMethod === "pin" && (
                <button
                  type="button"
                  onClick={() => setUnlockMethod("pin")}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {t("settings.security.changePin")}
                </button>
              )
            }
          >
            <SelectItem value="password">{t("login.password")}</SelectItem>
            <SelectItem value="pin">{t("unlock.pinCode")}</SelectItem>
            <SelectItem value="stay-unlocked">
              {t("settings.stayUnlocked.title")}
            </SelectItem>
          </SettingsSelect>
        </Field>

        {unlockMethod === "stay-unlocked" && (
          <div className="flex gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <TriangleAlert className="size-4 shrink-0 mt-0.5" />
            <span>{t("settings.security.masterKeyWarning")}</span>
          </div>
        )}

        <Field orientation="responsive">
          <SettingsLabel settingKey="autoLock" />
          <SettingsSelect
            labelledBy={settingLabelId("autoLock")}
            value={autoLock}
            onValueChange={(value) => setAutoLock(value as AutoLockOption)}
            disabled={unlockMethod === "stay-unlocked"}
          >
            <SelectItem value="disabled">
              {t("settings.security.autoLock.disabled")}
            </SelectItem>
            <SelectItem value="focus">
              {t("settings.security.autoLock.focus")}
            </SelectItem>
            <SelectItem value="5m">
              {t("move.minutes", { count: 5 })}
            </SelectItem>
            <SelectItem value="10m">
              {t("move.minutes", { count: 10 })}
            </SelectItem>
            <SelectItem value="15m">
              {t("move.minutes", { count: 15 })}
            </SelectItem>
            <SelectItem value="30m">
              {t("move.minutes", { count: 30 })}
            </SelectItem>
            <SelectItem value="45m">
              {t("move.minutes", { count: 45 })}
            </SelectItem>
            <SelectItem value="1h">{t("move.hours", { count: 1 })}</SelectItem>
          </SettingsSelect>
        </Field>
      </Section>

      <Separator />

      <SessionsSection sectionRefs={sectionRefs} {...sessions} />
    </FieldGroup>
  );
}

export default function SecurityPage(props: { sectionRefs: SectionRefs }) {
  return (
    <SecuritySettingsProvider>
      <SecurityPageContent {...props} />
    </SecuritySettingsProvider>
  );
}
