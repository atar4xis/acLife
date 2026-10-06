import {
  importKeyPair,
  MAX_PASSWORD_LENGTH,
  unwrapKeyPairWithPin,
} from "@/lib/crypt";
import { unlockAccount } from "@/lib/unlockAccount";
import { useStorage } from "@/context/StorageContext";
import { Card, CardContent } from "../ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Field, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { useUser } from "@/context/UserContext";
import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { useTranslation } from "react-i18next";

export default function UnlockDialog() {
  const { user, setMasterKey, setBucketKey, logout } = useUser();
  const storage = useStorage();
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingAutoUnlock, setCheckingAutoUnlock] = useState(true);
  const [usePin, setUsePin] = useState(false);

  const unlockMethod = storage.get("unlockMethod") || "password";
  const pinWrappedKeys = storage.get("pinWrappedKeys");

  // try auto-unlock, and show the pin form when a pin is set up
  useEffect(() => {
    if (!storage.ready) return;

    (async () => {
      if (unlockMethod === "stay-unlocked") {
        const unlockKeys = storage.get("unlockKeys");
        if (unlockKeys) {
          try {
            const { masterKey, bucketKey } = await importKeyPair(
              unlockKeys.masterKeyB64,
              unlockKeys.bucketKeyB64,
            );
            setMasterKey(masterKey);
            setBucketKey(bucketKey);
            return;
          } catch (err) {
            console.error("Auto-unlock error:", err);
          }
        }
      } else if (unlockMethod === "pin" && pinWrappedKeys) {
        setUsePin(true);
      }

      setCheckingAutoUnlock(false);
    })();

    // eslint-disable-next-line
  }, [storage.ready]);

  if (!user || user.type != "online" || checkingAutoUnlock) return null;

  const handlePinSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!pinWrappedKeys) return;

    setLoading(true);

    const pin = new FormData(e.currentTarget).get("pin") as string;

    try {
      const { masterKey, bucketKey } = await unwrapKeyPairWithPin(
        pin,
        pinWrappedKeys.salt,
        pinWrappedKeys.encrypted,
      );
      setError(false);
      setMasterKey(masterKey);
      setBucketKey(bucketKey);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const form = e.currentTarget;
    const data = new FormData(form);

    const password = data.get("password") as string;

    try {
      const exportable =
        unlockMethod === "stay-unlocked" || unlockMethod === "pin";
      const { masterKey, bucketKey } = await unlockAccount(
        password,
        user,
        exportable,
      );
      setError(false);
      setMasterKey(masterKey);
      setBucketKey(bucketKey);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-center">{t("unlock.title")}</DialogTitle>
          <DialogDescription className="text-center">
            {t("unlock.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6 text-center">
          <Card className="bg-transparent border-none shadow-none">
            <CardContent>
              {usePin ? (
                <form onSubmit={handlePinSubmit}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="pin">
                        {t("unlock.pinCode")}
                      </FieldLabel>
                      <Input
                        id="pin"
                        name="pin"
                        type="password"
                        inputMode="numeric"
                        placeholder={t("unlock.pinPlaceholder")}
                        autoFocus
                        required
                      />
                    </Field>
                    {error && (
                      <span className="text-sm text-destructive text-start">
                        {t("unlock.invalidPin")}
                      </span>
                    )}
                    <Field>
                      <Button type="submit" disabled={loading}>
                        {t("common.continue")}
                      </Button>
                    </Field>
                  </FieldGroup>
                </form>
              ) : (
                <form onSubmit={handleFormSubmit}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="password">
                        {t("login.password")}
                      </FieldLabel>
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        maxLength={MAX_PASSWORD_LENGTH}
                        placeholder={t("login.passwordPlaceholder")}
                        autoFocus
                        required
                      />
                    </Field>
                    {error && (
                      <span className="text-sm text-destructive text-start">
                        {t("unlock.invalidPassword")}
                      </span>
                    )}
                    <Field>
                      <Button type="submit" disabled={loading}>
                        {t("common.continue")}
                      </Button>
                    </Field>
                  </FieldGroup>
                </form>
              )}
              {pinWrappedKeys && (
                <Button
                  className="mt-2 w-full"
                  variant="ghost"
                  onClick={() => {
                    setError(false);
                    setUsePin((v) => !v);
                  }}
                >
                  {usePin ? t("unlock.usePassword") : t("unlock.usePin")}
                </Button>
              )}
              <Button
                className="mt-2 w-full"
                variant="outline"
                onClick={logout}
              >
                {t("user.logout")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
