import LoginDialog from "@/components/login/LoginDialog";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { UserProvider, useUser } from "@/context/UserContext";
import type { WithChildren } from "@/types/Props";
import AppShell from "./components/AppShell";
import { StorageProvider } from "./context/StorageContext";
import { CalendarProvider } from "./context/CalendarContext";
import { SettingsStoreProvider } from "./context/SettingsStoreContext";
import { ApiProvider, useApi } from "./context/ApiContext";
import { useEffect, useRef } from "react";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import { Direction } from "radix-ui";
import { useTranslation } from "react-i18next";
import LanguageSync from "@/components/LanguageSync";

function AuthWrapper({ children }: WithChildren) {
  const { user, isUnlocking, checkLogin, setUser } = useUser();
  const { url, pendingLogout, setPendingLogout } = useApi();
  const prevUrl = useRef(url);

  useEffect(() => {
    if (checkLogin && !user && url && url !== prevUrl.current) {
      checkLogin();
      prevUrl.current = url;
    }
  }, [url, checkLogin, user]);

  useEffect(() => {
    if (!pendingLogout) return;

    setUser(null);
    setPendingLogout(false);
  }, [pendingLogout, setPendingLogout, setUser]);

  if (!user || isUnlocking) return <LoginDialog />;

  return children;
}

export default function App() {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") !== "false") return;

    toast.error(t("app.emailVerificationFailed"));

    params.delete("verified");
    const newSearch = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (newSearch ? `?${newSearch}` : ""),
    );
  }, [t]);

  return (
    <Direction.Provider dir={i18n.dir()}>
      <SettingsStoreProvider>
        <LanguageSync />
        <ThemeProvider>
          <ApiProvider>
            <StorageProvider>
              <UserProvider>
                <CalendarProvider>
                  <SidebarProvider defaultWidth="18rem" defaultOpen={true}>
                    <Toaster position="bottom-center" />
                    <AuthWrapper>
                      <AppShell />
                    </AuthWrapper>
                  </SidebarProvider>
                </CalendarProvider>
              </UserProvider>
            </StorageProvider>
          </ApiProvider>
        </ThemeProvider>
      </SettingsStoreProvider>
    </Direction.Provider>
  );
}
