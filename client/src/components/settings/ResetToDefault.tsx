import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";

export default function ResetToDefault({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("settings.resetToDefault")}
          className="size-5 text-muted-foreground hover:text-foreground"
          onClick={onClick}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("settings.resetToDefault")}</TooltipContent>
    </Tooltip>
  );
}
