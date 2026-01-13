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
import { CreditCardIcon, LogInIcon, LogOutIcon, User } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/context/ApiContext";

export default function UserDropdown() {
  const { user, setUser, logout } = useUser();
  const { get } = useApi();

  if (!user) return null;

  const manageSubscription = async () => {
    const res = await get<string>("stripe/manage");

    if (!res.success || !res.data) {
      toast.error(res.message || "Failed to open management portal.");
      return;
    }

    window.open(res.data);
  };

  return (
    <DropdownMenu>
      <Button asChild size="icon" variant="outline">
        <DropdownMenuTrigger>
          <User />
        </DropdownMenuTrigger>
      </Button>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuLabel>
          {user.type === "online" ? user.email : "Offline mode"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {user.type === "online" ? (
            <>
              <DropdownMenuItem onClick={manageSubscription}>
                <CreditCardIcon />
                Manage Subscription
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout}>
                <LogOutIcon />
                Log out
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onClick={() => setUser(null)}>
                <LogInIcon />
                Log in
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
