import LoginDialog from "@/components/login/LoginDialog";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { UserProvider, useUser } from "@/context/UserContext";
import type { WithChildren } from "@/types/Props";
import AppShell from "./components/AppShell";
import { StorageProvider } from "./context/StorageContext";
import { CalendarProvider } from "./context/CalendarContext";
import { ApiProvider, useApi } from "./context/ApiContext";
import { useEffect } from "react";
import { Toaster } from "./components/ui/sonner";

function AuthWrapper({ children }: WithChildren) {
  const { user, checkLogin } = useUser();
  const { url } = useApi();

  useEffect(() => {
    if (!user && url) checkLogin();
  }, [url]);

  if (!user) return <LoginDialog />;

  return children;
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
