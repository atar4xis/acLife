import LoginDialog from "@/components/login/LoginDialog";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { UserProvider, useUser } from "@/context/UserContext";
import type { WithChildren } from "@/types/Props";
import AppShell from "./components/AppShell";
import { StorageProvider } from "./context/StorageContext";
import { CalendarProvider } from "./context/CalendarContext";
import { ApiProvider, useApi } from "./context/ApiContext";
import UnlockDialog from "./components/login/UnlockDialog";
import { useEffect } from "react";
import SubscriptionDialog from "./components/subscription/SubscriptionDialog";
import { Toaster } from "./components/ui/sonner";

function AuthWrapper({ children }: WithChildren) {
  const { user, checkLogin, masterKey } = useUser();
  const { url, serverMeta } = useApi();

  useEffect(() => {
    if (!user && url) checkLogin();
  }, [url]);

  const activeSub =
    user?.type === "online" && user.subscription_status === "active";

  const subRequired = serverMeta?.registration.subscriptionRequired;

  return (
    <>
      {!user && <LoginDialog />}
      {user && !activeSub && subRequired && <SubscriptionDialog />}
      {user && (activeSub || !subRequired) && masterKey === null && (
        <UnlockDialog />
      )}
      {children}
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="ui-theme">
      <ApiProvider>
        <StorageProvider>
          <UserProvider>
            <CalendarProvider>
              <SidebarProvider defaultWidth="18rem" defaultOpen={true}>
                <AuthWrapper>
                  <Toaster position="bottom-center" />
                  <AppShell />
                </AuthWrapper>
              </SidebarProvider>
            </CalendarProvider>
          </UserProvider>
        </StorageProvider>
      </ApiProvider>
    </ThemeProvider>
  );
}
