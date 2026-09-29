import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function ResetToDefault({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Reset to default"
          className="size-5 text-muted-foreground hover:text-foreground"
          onClick={onClick}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Reset to default</TooltipContent>
    </Tooltip>
  );
}
