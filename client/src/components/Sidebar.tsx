import { ModeToggle } from "@/components/ModeToggle";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useCalendar } from "@/context/CalendarContext";
import { Settings } from "lucide-react";
import { DateTime } from "luxon";
import UserDropdown from "./user/UserDropdown";
import { useStorage } from "@/context/StorageContext";
import { useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

export default function AppSidebar() {
  const { currentDate, setCurrentDate } = useCalendar();
  const isMobile = useIsMobile();
  const { open, setOpen } = useSidebar();
  const storage = useStorage();

  useEffect(() => {
    if (isMobile || !storage) return;

    const lastOpenState = storage.get("sidebarOpen");
    setOpen(lastOpenState);

    // eslint-disable-next-line
  }, [isMobile]);

  useEffect(() => {
    if (isMobile || !storage) return;

    storage.set("sidebarOpen", open);

    // eslint-disable-next-line
  }, [open, isMobile]);

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarContent>
        <SidebarGroup>
          <Calendar
            mode="single"
            selected={currentDate.toJSDate()}
            onSelect={(date) => {
              setCurrentDate(DateTime.fromJSDate(date || new Date()));
            }}
            className="w-full rounded-md border"
            weekStartsOn={1}
          />
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail enableDrag={true} />
      <SidebarFooter>
        <div className="flex justify-between">
          <div className="flex gap-2">
            <ModeToggle />
            <Button variant="outline" size="icon">
              <Settings />
            </Button>
          </div>

          <UserDropdown />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
