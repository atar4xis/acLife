import type { WithChildren } from "@/types/Props";
import type { User } from "@/types/User";
import { createContext, useContext, useEffect, useState } from "react";
import { useApi } from "./ApiContext";
import { unlockAccount } from "@/lib/unlockAccount";
import { useStorage } from "@/context/StorageContext";

type UserContextValue = {
  user: User | null;
  masterKey: CryptoKey | null;
  bucketKey: CryptoKey | null;
  isUnlocking: boolean;
  setUser: (user: User | null) => void;
  setMasterKey: (key: CryptoKey | null) => void;
  setBucketKey: (key: CryptoKey | null) => void;
  logout: () => Promise<void>;
  checkLogin: (password?: string) => Promise<User | void>;
};

const UserContext = createContext<UserContextValue>({
  user: null,
  masterKey: null,
  bucketKey: null,
  isUnlocking: false,
  setUser: () => {},
  setMasterKey: () => {},
  setBucketKey: () => {},
  logout: async () => {},
  checkLogin: async () => {},
});

export function UserProvider({ children }: WithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [bucketKey, setBucketKey] = useState<CryptoKey | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
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
        setIsUnlocking(true);
        try {
          const { masterKey, bucketKey } = await unlockAccount(
            password,
            newUser,
          );
          setMasterKey(masterKey);
          setBucketKey(bucketKey);
        } catch {
          setMasterKey(null); // will prompt UnlockDialog to ask for the password again
          setBucketKey(null);
        } finally {
          setIsUnlocking(false);
        }
      }
      return newUser;
    } else {
      setUser(null);
    }
  };

  const logout = async () => {
    await post("auth/logout", null);
    storage.set("unlockMethod", "password");
    storage.set("unlockKeys", null);
    storage.set("pinWrappedKeys", null);
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
        isUnlocking,
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
