import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Trans } from "react-i18next";
import type { ServerMetadata } from "@/types/ServerMetadata";
import { useUser } from "@/context/UserContext";
import {
  generateMasterKeyEnvelope,
  generateSRPTriplet,
  MAX_PASSWORD_LENGTH,
  solveProofOfWork,
} from "@/lib/crypt";
import { srpLogin } from "@/lib/srpLogin";
import { useStorage } from "@/context/StorageContext";
import { validatePassword } from "@/lib/validators";
import { useApi } from "@/context/ApiContext";
import { Spinner } from "../ui/spinner";
import { useTranslation } from "react-i18next";

export function LoginForm({
  handleOfflineClick,
  serverMeta,
  onNeedsVerification,
}: {
  serverMeta: ServerMetadata;
  handleOfflineClick: (e: React.MouseEvent) => void;
  onNeedsVerification: (email: string) => void;
}) {
  const { t } = useTranslation();
  const [newAccount, setNewAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const storage = useStorage();
  const { checkLogin } = useUser();
  const { post } = useApi();

  if (!storage) return null;

  const handleCreateAccountClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setNewAccount(!newAccount);
  };

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const form = e.currentTarget;
    const data = new FormData(form);

    const email = data.get("email") as string;
    const password = data.get("password") as string;
    const confirm = data.get("confirm-password") as string;

    setError(null);
    setSuccess(null);

    if (newAccount) {
      // ----- REGISTRATION FLOW -----
      if (!email || !password || !confirm) {
        setError(t("login.fillAll"));
        return;
      }

      if (password !== confirm) {
        setError(t("login.passwordsMismatch"));
        return;
      }

      if (password.length < 12 || password.length > 256) {
        setError(t("login.passwordLength"));
        return;
      }

      if (!validatePassword(password)) {
        setError(t("login.passwordStrength"));
        return;
      }

      setLoading(true);

      try {
        const challengeRes = await post<{ token: string; difficulty: number }>(
          "auth/register/challenge",
          { email },
        );
        if (!challengeRes.success || !challengeRes.data) {
          setError(challengeRes.message || t("common.unknownError"));
          return;
        }

        const powNonce = await solveProofOfWork(
          challengeRes.data.token,
          challengeRes.data.difficulty,
        );

        const triplet = await generateSRPTriplet(email, password);
        const { envelope } = await generateMasterKeyEnvelope(password);
        const confirmEmail = data.get("confirm-email") as string; // honeypot field

        const res = await post("auth/register", {
          triplet: btoa(String.fromCharCode(...triplet.toUint8Array())),
          envelopes: [envelope],
          powToken: challengeRes.data.token,
          powNonce,
          ...(confirmEmail ? { email: confirmEmail } : {}),
        });

        if (!res.success) {
          setError(res.message || t("common.unknownError"));
          return;
        }

        form.reset();
        setNewAccount(false);

        if (serverMeta.registration.email?.verificationRequired) {
          onNeedsVerification(email);
          return;
        }

        setSuccess(t("login.accountCreated"));
      } finally {
        setLoading(false);
      }

      return; // ensure login flow is never triggered
    }

    // ----- LOGIN FLOW -----
    if (!email || !password) {
      setError(t("login.fillAll"));
      return;
    }

    setLoading(true);

    try {
      const login = await srpLogin(post, email, password);
      if (!login.success) {
        setError(login.message);
        return;
      }

      await checkLogin(password);
    } finally {
      setLoading(false);
    }
  };

  const canRegister = serverMeta.registration.enabled !== false;

  return (
    <div className="flex flex-col gap-6 text-center">
      <Card className="bg-transparent border-none shadow-none">
        <CardContent>
          <form onSubmit={handleFormSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">{t("login.email")}</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  name="email"
                  placeholder={t("login.emailPlaceholder")}
                  required
                />
              </Field>
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
                  required
                />
              </Field>

              {newAccount ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="confirm-password">
                      {t("login.confirmPassword")}
                    </FieldLabel>
                    <Input
                      id="confirm-password"
                      name="confirm-password"
                      type="password"
                      maxLength={MAX_PASSWORD_LENGTH}
                      placeholder={t("login.confirmPasswordPlaceholder")}
                      required
                    />
                  </Field>
                  <Field
                    style={{
                      position: "fixed",
                      top: "-7777px",
                      width: "1px",
                      height: "1px",
                      overflow: "hidden",
                    }}
                  >
                    <FieldLabel htmlFor="confirm-email">
                      {t("login.confirmEmail")}
                    </FieldLabel>
                    <Input
                      id="confirm-email"
                      name="confirm-email"
                      type="email"
                      placeholder={t("login.confirmEmailPlaceholder")}
                      tabIndex={-1}
                      autoComplete="off"
                    />
                  </Field>
                  {serverMeta.policies.terms || serverMeta.policies.privacy ? (
                    <div className="flex items-center gap-2">
                      <Checkbox id="accept-terms" required />
                      <Label htmlFor="accept-terms">
                        <Trans
                          i18nKey={
                            serverMeta.policies.terms &&
                            serverMeta.policies.privacy
                              ? "login.acceptBoth"
                              : serverMeta.policies.terms
                                ? "login.acceptTerms"
                                : "login.acceptPrivacy"
                          }
                          components={{
                            terms: (
                              // eslint-disable-next-line
                              <a
                                href={serverMeta.policies.terms}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              />
                            ),
                            privacy: (
                              // eslint-disable-next-line
                              <a
                                href={serverMeta.policies.privacy}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              />
                            ),
                          }}
                        />
                      </Label>
                    </div>
                  ) : null}
                </>
              ) : null}
              {error && (
                <span className="text-sm text-destructive text-start">
                  {error}
                </span>
              )}
              {success && !error && (
                <span className="text-sm text-success text-start">
                  {success}
                </span>
              )}
              <Field>
                <Button type="submit" disabled={loading}>
                  {loading ? <Spinner /> : t("common.continue")}
                </Button>
                {canRegister ? (
                  <Button variant="outline" onClick={handleCreateAccountClick}>
                    {newAccount
                      ? t("login.haveAccount")
                      : t("login.createAccount")}
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="w-full">
                        <Button
                          variant="outline"
                          disabled
                          className="w-full"
                          onClick={(e) => e.preventDefault()}
                        >
                          {t("login.createAccount")}
                        </Button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>{t("login.registrationsClosed")}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                <Button variant="link" onClick={handleOfflineClick}>
                  {t("login.offlineMode")}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
