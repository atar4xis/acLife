import { unlockMasterKey } from "@/lib/crypt";
import { migrateMasterKeyToArgon2id } from "@/lib/calendar/crypt";
import { useApi } from "@/context/ApiContext";
import { useStorage } from "@/context/StorageContext";
import { toast } from "sonner";
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
  const { user, setMasterKey, setBucketKey, logout } = useUser();
  const { post } = useApi();
  const storage = useStorage();
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
    const encryptedChallenge = Uint8Array.from(
      atob(atob(user.challenge)),
      (c) => c.charCodeAt(0),
    );

    try {
      const { masterKey, bucketKey, needsMigration } = await unlockMasterKey(
        password,
        salt,
        encryptedChallenge,
      );
      setMasterKey(masterKey);
      setBucketKey(bucketKey);
      setError(false);

      // upgrade legacy Argon2d keys to Argon2id in the background
      if (needsMigration) {
        migrateMasterKeyToArgon2id(password, salt, masterKey, post, storage)
          .then((upgraded) => {
            setMasterKey(upgraded.masterKey);
            setBucketKey(upgraded.bucketKey);
            toast.success("Your account security has been upgraded.");
          })
          .catch((err) => console.error("Master key migration failed:", err));
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
