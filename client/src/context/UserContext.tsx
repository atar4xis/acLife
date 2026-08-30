import type { WithChildren } from "@/types/Props";
import type { User } from "@/types/User";
import { createContext, useContext, useEffect, useState } from "react";
import { useApi } from "./ApiContext";
import { unlockMasterKey } from "@/lib/crypt";
import { migrateMasterKeyToArgon2id } from "@/lib/calendar/crypt";
import { uint8ArrayFromBase64 } from "@/lib/utils";
import { useStorage } from "@/context/StorageContext";
import { toast } from "sonner";

type UserContextValue = {
  user: User | null;
  masterKey: CryptoKey | null;
  bucketKey: CryptoKey | null;
  setUser: (user: User | null) => void;
  setMasterKey: (key: CryptoKey | null) => void;
  setBucketKey: (key: CryptoKey | null) => void;
  logout: () => void;
  checkLogin: (password?: string) => Promise<User | void>;
};

const UserContext = createContext<UserContextValue>({
  user: null,
  masterKey: null,
  bucketKey: null,
  setUser: () => {},
  setMasterKey: () => {},
  setBucketKey: () => {},
  logout: () => {},
  checkLogin: async () => {},
});

export function UserProvider({ children }: WithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [bucketKey, setBucketKey] = useState<CryptoKey | null>(null);
  const { get, post, setPendingVerificationEmail } = useApi();
  const storage = useStorage();

  const checkLogin = async (password: string | null = null) => {
    const res = await get<User>("user");
    if (res.success && res.data) {
      const newUser = {
        ...res.data,
        type: "online",
      } as User;

      if (newUser.type !== "online") throw new Error(); // won't happen

      setUser(newUser);
      setPendingVerificationEmail(null);
      if (password) {
        try {
          const salt = uint8ArrayFromBase64(newUser.salt);
          const encryptedChallenge = uint8ArrayFromBase64(
            atob(newUser.challenge),
          );
          const { masterKey, bucketKey, needsMigration } =
            await unlockMasterKey(password, salt, encryptedChallenge);
          setMasterKey(masterKey);
          setBucketKey(bucketKey);

          // upgrade legacy Argon2d keys to Argon2id in the background
          if (needsMigration) {
            migrateMasterKeyToArgon2id(password, salt, masterKey, post, storage)
              .then((upgraded) => {
                setMasterKey(upgraded.masterKey);
                setBucketKey(upgraded.bucketKey);
                toast.success("Your account security has been upgraded.");
              })
              .catch((err) =>
                console.error("Master key migration failed:", err),
              );
          }
        } catch {
          setMasterKey(null); // will prompt UnlockDialog to ask for the password again
          setBucketKey(null);
        }
      }
      return newUser;
    } else {
      setUser(null);
    }
  };

  const logout = async () => {
    await post("auth/logout", null);
    checkLogin();
  };

  // invalidate master key if the user is null
  useEffect(() => {
    if (user === null) {
      setMasterKey(null);
      setBucketKey(null);
    }
  }, [user]);

  return (
    <UserContext.Provider
      value={{
        user,
        masterKey,
        bucketKey,
        setMasterKey,
        setBucketKey,
        setUser,
        logout,
        checkLogin,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

// eslint-disable-next-line
export function useUser() {
  const context = useContext(UserContext);
  return context;
}
