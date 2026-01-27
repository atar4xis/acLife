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
import type { ServerMetadata } from "@/types/ServerMetadata";
import { useUser } from "@/context/UserContext";
import {
  deriveMasterKey,
  encrypt,
  generateSRPTriplet,
  SRP_CheckM2,
  SRP_PARAMS,
  UNLOCK_CHECK_BYTES,
} from "@/lib/crypt";
import { useStorage } from "@/context/StorageContext";
import { validatePassword } from "@/lib/validators";
import { useApi } from "@/context/ApiContext";
import { Client, generateSalt } from "@mzattahri/srp";

export function LoginForm({
  handleOfflineClick,
  serverMeta,
}: {
  serverMeta: ServerMetadata;
  handleOfflineClick: (e: React.MouseEvent) => void;
}) {
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
        setError("Please fill out all the fields.");
        return;
      }

      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }

      if (password.length < 12 || password.length > 256) {
        setError("Password must be 12 to 256 characters long.");
        return;
      }

      if (!validatePassword(password)) {
        setError(
          "Password must include uppercase and lowercase letters, a number, and a special character.",
        );
        return;
      }

      setLoading(true);

      try {
        const triplet = await generateSRPTriplet(email, password);
        const masterSalt = generateSalt();
        const masterKey = await deriveMasterKey(password, masterSalt);
        const challenge = await encrypt(UNLOCK_CHECK_BYTES, masterKey);

        const res = await post("auth/register", {
          challenge: btoa(String.fromCharCode(...new Uint8Array(challenge))),
          triplet: btoa(String.fromCharCode(...triplet.toUint8Array())),
          salt: btoa(String.fromCharCode(...masterSalt)),
        });

        if (!res.success) {
          setError(res.message || "An unknown error occurred.");
          return;
        }

        form.reset();
        setNewAccount(false);
        setSuccess("Account created. You may now log in.");
      } finally {
        setLoading(false);
      }

      return; // ensure login flow is never triggered
    }

    // ----- LOGIN FLOW -----
    if (!email || !password) {
      setError("Please fill out all the fields.");
      return;
    }

    setLoading(true);

    try {
      const saltResponse = await post<string>("auth/login/start", { email });
      if (!saltResponse.success || !saltResponse.data) {
        setError(saltResponse.message || "An unknown error occurred.");
        return;
      }

      const salt = Uint8Array.from(atob(saltResponse.data), (c) =>
        c.charCodeAt(0),
      );
      const client = await Client.initialize(SRP_PARAMS, email, password, salt);

      // stage 1 - send salt along with A
      const res1 = await post<{
        salt: string;
        B: string;
        session_id: string;
      }>("auth/login/start", {
        email,
        A: btoa(String.fromCharCode(...client.A)),
      });

      if (!res1.success || !res1.data) {
        setError(res1.message || "An unknown error occurred.");
        return;
      }

      const B = Uint8Array.from(atob(res1.data.B), (c) => c.charCodeAt(0));
      await client.setB(B);
      const M1 = btoa(String.fromCharCode(...client.M1));

      // stage 2 - send M1
      const res2 = await post<{ M2: string }>("auth/login/verify", {
        email,
        M1,
        session_id: res1.data.session_id,
      });

      if (!res2.success || !res2.data) {
        setError(res2.message || "An unknown error occurred.");
        return;
      }

      const M2 = Uint8Array.from(atob(res2.data.M2), (c) => c.charCodeAt(0));

      // workaround for SRP_CheckM2 bug
      // eslint-disable-next-line
      if (!SRP_CheckM2((client as any).M2, M2, SRP_PARAMS.group.bitLength)) {
        setError("Failed to verify server integrity.");
        return;
      }

      checkLogin(password);
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
                <FieldLabel htmlFor="email">Email Address</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  name="email"
                  placeholder="me@example.com"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Enter password"
                  required
                />
              </Field>

              {newAccount ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="confirm-password">
                      Confirm Password
                    </FieldLabel>
                    <Input
                      id="confirm-password"
                      name="confirm-password"
                      type="password"
                      placeholder="Confirm password"
                      required
                    />
                  </Field>
                  {serverMeta.policies.terms || serverMeta.policies.privacy ? (
                    <div className="flex items-center gap-2">
                      <Checkbox id="accept-terms" required />
                      <Label htmlFor="accept-terms">
                        {serverMeta.policies.terms &&
                        serverMeta.policies.privacy ? (
                          <span>
                            I accept the{" "}
                            <a
                              href={serverMeta.policies.terms}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              terms
                            </a>{" "}
                            and{" "}
                            <a
                              href={serverMeta.policies.privacy}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              privacy policy
                            </a>
                          </span>
                        ) : serverMeta.policies.terms ? (
                          <span>
                            I accept the{" "}
                            <a
                              href={serverMeta.policies.terms}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              terms
                            </a>
                          </span>
                        ) : serverMeta.policies.privacy ? (
                          <span>
                            I accept the{" "}
                            <a
                              href={serverMeta.policies.privacy}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              privacy policy
                            </a>
                          </span>
                        ) : null}
                      </Label>
                    </div>
                  ) : null}
                </>
              ) : null}
              {error && (
                <span className="text-sm text-red-700 dark:text-red-400 text-left">
                  {error}
                </span>
              )}
              {success && !error && (
                <span className="text-sm text-green-700 dark:text-green-400 text-left">
                  {success}
                </span>
              )}
              <Field>
                <Button type="submit" disabled={loading}>
                  Continue
                </Button>
                {canRegister ? (
                  <Button variant="outline" onClick={handleCreateAccountClick}>
                    {newAccount ? "Have an account? Log in" : "Create Account"}
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
                          Create Account
                        </Button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>This server is not accepting registrations.</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                <Button variant="link" onClick={handleOfflineClick}>
                  Use in Offline Mode
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
