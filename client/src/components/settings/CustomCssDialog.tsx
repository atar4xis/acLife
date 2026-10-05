import { useState } from "react";
import { useTranslation } from "react-i18next";
import Editor from "react-simple-code-editor";
import { highlight, languages } from "prismjs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAX_CUSTOM_CSS_LENGTH } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { settingLabel } from "./settingsData";

export default function CustomCssDialog({
  open,
  onOpenChange,
  value,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onApply: (css: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const tooLong = draft.length > MAX_CUSTOM_CSS_LENGTH;
  const dirty = draft !== value;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{settingLabel("custom-css")}</DialogTitle>
        </DialogHeader>
        <div className="border-input bg-background max-h-[50vh] overflow-auto rounded-md border">
          <Editor
            value={draft}
            onValueChange={setDraft}
            highlight={(code) => highlight(code, languages.css, "css")}
            padding={12}
            aria-label={settingLabel("custom-css")}
            spellCheck={false}
            className="css-editor min-h-48 font-mono text-sm"
          />
        </div>
        <p
          className={cn(
            "text-muted-foreground text-xs",
            tooLong && "text-destructive",
          )}
        >
          {draft.length} / {MAX_CUSTOM_CSS_LENGTH}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t(dirty ? "common.cancel" : "common.close")}
          </Button>
          <Button disabled={!dirty || tooLong} onClick={() => onApply(draft)}>
            {t("common.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
