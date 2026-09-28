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
import AgendaList from "./calendar/AgendaList";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";

export default function AppSidebar({
  onOpenSettings,
}: {
  onOpenSettings: (categoryId?: string) => void;
}) {
  const { currentDate, setCurrentDate } = useCalendar();
  const { weekStartsOn, agendaEnabled } = useCalendarSettings((s) => ({
    weekStartsOn: s.weekStartsOn,
    agendaEnabled: s.agendaEnabled,
  }));
  const isMobile = useIsMobile();
  const { open, setOpen, setOpenMobile } = useSidebar();
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
              if (isMobile) setOpenMobile(false);
              setCurrentDate(DateTime.fromJSDate(date || new Date()));
            }}
            className="w-full rounded-md border"
            weekStartsOn={weekStartsOn === "sun" ? 0 : 1}
          />
        </SidebarGroup>
        {agendaEnabled && <AgendaList />}
      </SidebarContent>
      <SidebarRail enableDrag={true} />
      <SidebarFooter>
        <div className="flex justify-between">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => onOpenSettings()}
            >
              <Settings />
            </Button>
          </div>

          <UserDropdown
            onOpenAccountSettings={() => onOpenSettings("security")}
          />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
