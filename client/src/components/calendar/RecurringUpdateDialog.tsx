import { memo, useLayoutEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";

type RecurringUpdateDialogOptions = {
  action: "Update" | "Delete";
  defaultOption: "this" | "future" | "all";
  open: boolean;
  setOpen: (open: boolean) => void;
  onSubmit: (option: string) => void;
  onCancel: () => void;
  onFocusReturned?: (toOpener: boolean) => void;
};

export default memo(function RecurringUpdateDialog({
  action,
  defaultOption,
  open,
  setOpen,
  onSubmit,
  onCancel,
  onFocusReturned,
}: RecurringUpdateDialogOptions) {
  const [option, setOption] = useState<string>(defaultOption);
  const openerRef = useRef<Element | null>(null);

  // the dialog has no trigger, so remember what had focus to give it back on close
  useLayoutEffect(() => {
    if (open) openerRef.current = document.activeElement;
  }, [open]);

  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        className="w-auto text-center"
        data-recurring-dialog=""
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const opener = openerRef.current;
          const toOpener = opener instanceof HTMLElement && opener.isConnected;
          if (toOpener) opener.focus({ preventScroll: true });
          onFocusReturned?.(toOpener);
        }}
      >
        <AlertDialogTitle>{action} recurring event</AlertDialogTitle>
        <AlertDialogDescription>
          Which event would you like to {action.toLowerCase()}?
        </AlertDialogDescription>
        <RadioGroup
          value={option}
          onValueChange={setOption}
          className="mt-3 gap-5 text-left"
        >
          <div className="flex gap-3">
            <RadioGroupItem value="this" id="this" />
            <Label htmlFor="this">This event</Label>
          </div>
          <div className="flex gap-3">
            <RadioGroupItem value="future" id="future" />
            <Label htmlFor="future">This and future events</Label>
          </div>
          <div className="flex gap-3">
            <RadioGroupItem value="all" id="all" />
            <Label htmlFor="all">All events</Label>
          </div>
        </RadioGroup>
        <AlertDialogFooter className="!flex-col mt-5">
          <AlertDialogAction
            onClick={() => {
              onSubmit(option);
              setOpen(false);
            }}
          >
            {action}
          </AlertDialogAction>
          <AlertDialogCancel
            onClick={() => {
              onCancel();
              setOpen(false);
            }}
          >
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
});
