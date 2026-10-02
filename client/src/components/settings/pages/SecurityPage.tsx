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
import { validatePassword } from "@/lib/validators";
import { bytesToBase64, uint8ArrayFromBase64 } from "@/lib/utils";
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
      setError("Please fill out all the fields.");
      return;
    }
    if (newEmail === currentEmail) {
      setError("This is already your email address.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(newEmail, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change email.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change email</DialogTitle>
          <DialogDescription>
            {verificationRequired
              ? "You will need to verify your new email address before you can log in again. Entering the wrong email will lock you out of your account."
              : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="new-email">New email</FieldLabel>
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
              Current password
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
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : "Save"}
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
      setError("Please fill out all the fields.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!validatePassword(newPassword)) {
      setError(
        "Password must be 12 to 256 characters long and include uppercase and lowercase letters, a number, and a special character.",
      );
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(currentPassword, newPassword);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to change password.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription></DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
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
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
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
              Confirm new password
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
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : "Save"}
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
  const { user, masterKey, checkLogin } = useUser();
  const { post, serverMeta } = useApi();
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  if (!user || user.type !== "online") return null;

  const fetchCurrentSalt = async (): Promise<Uint8Array> => {
    const saltRes = await post<string>("auth/login/start", {
      email: user.email,
    });
    if (!saltRes.success || !saltRes.data) {
      throw new Error(saltRes.message || "Failed to verify current password.");
    }
    return uint8ArrayFromBase64(saltRes.data);
  };

  const handleEmailChange = async (
    newEmail: string,
    currentPassword: string,
  ) => {
    const currentSalt = await fetchCurrentSalt();

    const [triplet, currentTriplet] = await Promise.all([
      generateSRPTriplet(newEmail, currentPassword),
      generateSRPTriplet(user.email, currentPassword, currentSalt),
    ]);

    const res = await post<{ email: string; requiresVerification: boolean }>(
      "user/email",
      {
        current_triplet: bytesToBase64(currentTriplet.toUint8Array()),
        triplet: bytesToBase64(triplet.toUint8Array()),
      },
    );

    if (res.data?.requiresVerification) {
      setEmailDialogOpen(false);
      toast.success(
        "Email address updated. Please verify your new email address.",
      );
      return;
    }

    if (!res.success) {
      throw new Error(res.message || "Failed to change email.");
    }

    await checkLogin();
    setEmailDialogOpen(false);
    toast.success("Email address updated.");
  };

  const handlePasswordChange = async (
    currentPassword: string,
    newPassword: string,
  ) => {
    if (!masterKey) {
      throw new Error("Your data must be decrypted to change your password.");
    }

    const currentSalt = await fetchCurrentSalt();

    // re-derive an exportable copy of the master key
    const [{ masterKey: verifiedMasterKey }, triplet, currentTriplet] =
      await Promise.all([
        unlockAccount(currentPassword, user, post, undefined, true),
        generateSRPTriplet(user.email, newPassword),
        generateSRPTriplet(user.email, currentPassword, currentSalt),
      ]);

    const envelope = await rewrapMasterKeyEnvelope(
      newPassword,
      verifiedMasterKey,
    );

    const res = await post<never>("user/password", {
      current_triplet: bytesToBase64(currentTriplet.toUint8Array()),
      triplet: bytesToBase64(triplet.toUint8Array()),
      envelopes: [envelope],
    });

    if (!res.success) {
      throw new Error(res.message || "Failed to change password.");
    }

    await checkLogin();
    setPasswordDialogOpen(false);
    onPasswordChanged();
    toast.success("Password updated.");
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
            Change email
          </Button>
        </Field>

        <Field orientation="responsive">
          <div className="flex flex-auto items-center gap-1.5">
            <FieldTitle>{settingLabel("account-password")}</FieldTitle>
          </div>
          <Button variant="outline" onClick={() => setPasswordDialogOpen(true)}>
            Change password
          </Button>
        </Field>
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
  const { del } = useApi();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const revoke = async (id: string) => {
    setRevokingId(id);
    const res = await del<never>(`user/sessions/${id}`);
    setRevokingId(null);

    if (!res.success) {
      toast.error(res.message || "Failed to end session.");
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
          aria-label="Refresh sessions"
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
        <FieldDescription>No active sessions.</FieldDescription>
      ) : (
        <div className="flex flex-col gap-2">
          {sessions.map((s, index) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-4 rounded-md border p-3"
            >
              <div className="flex flex-col gap-1">
                <FieldTitle>
                  Session #{sessions.length - index}{" "}
                  {s.current && (
                    <span className="text-xs px-2 bg-accent rounded-md">
                      current
                    </span>
                  )}
                </FieldTitle>
                <FieldDescription>
                  Logged in {DateTime.fromISO(s.createdAt).toRelative()}
                  {" - "}
                  Expires {DateTime.fromISO(s.expiresAt).toRelative()}
                </FieldDescription>
              </div>
              {!s.current && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revokingId === s.id}
                  onClick={() => revoke(s.id)}
                >
                  End session
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
  const { unlockMethod, autoLock, setUnlockMethod, setAutoLock } =
    useSecuritySettings();
  const sessions = useSessions();

  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">Account & Security</h2>

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
                  Change PIN
                </button>
              )
            }
          >
            <SelectItem value="password">Password</SelectItem>
            <SelectItem value="pin">PIN code</SelectItem>
            <SelectItem value="stay-unlocked">Stay unlocked</SelectItem>
          </SettingsSelect>
        </Field>

        {unlockMethod === "stay-unlocked" && (
          <div className="flex gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            <TriangleAlert className="size-4 shrink-0 mt-0.5" />
            <span>
              Your master key is stored on your device. Anyone with access to
              your device can access your data.
            </span>
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
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="focus">When focus lost</SelectItem>
            <SelectItem value="5m">5 minutes</SelectItem>
            <SelectItem value="10m">10 minutes</SelectItem>
            <SelectItem value="15m">15 minutes</SelectItem>
            <SelectItem value="30m">30 minutes</SelectItem>
            <SelectItem value="45m">45 minutes</SelectItem>
            <SelectItem value="1h">1 hour</SelectItem>
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
