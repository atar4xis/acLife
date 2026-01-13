import {
  decrypt,
  deriveMasterKey,
  timingSafeEqual,
  UNLOCK_CHECK_BYTES,
} from "@/lib/crypt";
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
import { useState } from "react";
import { Button } from "../ui/button";

export default function UnlockDialog() {
  const { user, setMasterKey, logout } = useUser();
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!user || user.type != "online") return null;

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const form = e.currentTarget;
    const data = new FormData(form);

    const password = data.get("password") as string;
    const salt = Uint8Array.from(atob(user.salt), (c) => c.charCodeAt(0));
    const masterKey = await deriveMasterKey(password, salt);

    try {
      const challenge = await decrypt(
        Uint8Array.from(atob(atob(user.challenge)), (c) => c.charCodeAt(0))
          .buffer,
        masterKey,
      );

      if (timingSafeEqual(challenge, UNLOCK_CHECK_BYTES)) {
        setMasterKey(masterKey);
        setError(false);
      } else {
        setError(true);
      }
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
          <DialogTitle className="text-center">Decrypt Data</DialogTitle>
          <DialogDescription className="text-center">
            You are logged in but your data is encrypted.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6 text-center">
          <Card className="bg-transparent border-none shadow-none">
            <CardContent>
              <form onSubmit={handleFormSubmit}>
                <FieldGroup>
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
                  {error && (
                    <span className="text-sm text-red-700 dark:text-red-400 text-left">
                      Invalid password.
                    </span>
                  )}
                  <Field>
                    <Button type="submit" disabled={loading}>
                      Continue
                    </Button>
                  </Field>
                </FieldGroup>
              </form>
              <Button
                className="mt-2 w-full"
                variant="outline"
                onClick={logout}
              >
                Log out
              </Button>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
