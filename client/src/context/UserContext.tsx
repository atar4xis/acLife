import type { WithChildren } from "@/types/Props";
import type { User } from "@/types/User";
import { createContext, useContext, useState } from "react";
import { useApi } from "./ApiContext";
import { deriveMasterKey } from "@/lib/crypt";
import { uint8ArrayFromBase64 } from "@/lib/utils";

type UserContextValue = {
  user: User | null;
  masterKey: CryptoKey | null;
  setUser: (user: User | null) => void;
  setMasterKey: (key: CryptoKey | null) => void;
  logout: () => void;
  checkLogin: (password?: string) => Promise<User | void>;
};

const UserContext = createContext<UserContextValue>({
  user: null,
  masterKey: null,
  setUser: () => {},
  setMasterKey: () => {},
  logout: () => {},
  checkLogin: async (_?: string) => {},
});

export function UserProvider({ children }: WithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const { get, post } = useApi();

  const checkLogin = async (password: string | null = null) => {
    const res = await get<User>("user");
    if (res.success && res.data) {
      const newUser = {
        ...res.data,
        type: "online",
      } as User;

      if (newUser.type !== "online") throw new Error(); // won't happen

      setUser(newUser);
      if (password)
        setMasterKey(
          await deriveMasterKey(password, uint8ArrayFromBase64(newUser.salt)),
        );
      return newUser;
    } else setUser(null);
  };

  const logout = async () => {
    await post("auth/logout", null);
    checkLogin();
  };

  return (
    <UserContext.Provider
      value={{ user, masterKey, setMasterKey, setUser, logout, checkLogin }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  return context;
}
