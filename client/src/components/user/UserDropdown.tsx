import { useUser } from "@/context/UserContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Button } from "../ui/button";
import {
  CreditCardIcon,
  LogInIcon,
  LogOutIcon,
  SettingsIcon,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/context/ApiContext";
import { useTranslation } from "react-i18next";

export default function UserDropdown({
  onOpenAccountSettings,
}: {
  onOpenAccountSettings: () => void;
}) {
  const { t } = useTranslation();
  const { user, setUser, logout } = useUser();
  const { get } = useApi();

  if (!user) return null;

  const manageSubscription = async () => {
    const res = await get<string>("stripe/manage");

    if (!res.success || !res.data) {
      toast.error(res.message || t("user.portalFailed"));
      return;
    }

    window.open(res.data);
  };

  return (
    <DropdownMenu>
      <Button asChild size="icon" variant="outline">
        <DropdownMenuTrigger aria-label={t("user.menu")}>
          <User />
        </DropdownMenuTrigger>
      </Button>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuLabel>
          {user.type === "online" ? user.email : t("user.offlineMode")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {user.type === "online" ? (
            <>
              <DropdownMenuItem onClick={onOpenAccountSettings}>
                <SettingsIcon />
                {t("user.accountSettings")}
              </DropdownMenuItem>
              {user.subscription_status && (
                <DropdownMenuItem onClick={manageSubscription}>
                  <CreditCardIcon />
                  {t("user.manageSubscription")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={logout}>
                <LogOutIcon />
                {t("user.logout")}
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onClick={() => setUser(null)}>
                <LogInIcon />
                {t("user.login")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
