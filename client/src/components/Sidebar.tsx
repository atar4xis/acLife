import { ModeToggle } from "@/components/ModeToggle";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useCalendar } from "@/context/CalendarContext";
import { Settings } from "lucide-react";
import { DateTime } from "luxon";
import UserDropdown from "./user/UserDropdown";

export default function AppSidebar() {
  const { currentDate, setCurrentDate } = useCalendar();

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
