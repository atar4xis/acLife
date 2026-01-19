import { memo, useState } from "react";
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
};

export default memo(function RecurringUpdateDialog({
  action,
  defaultOption,
  open,
  setOpen,
  onSubmit,
  onCancel,
}: RecurringUpdateDialogOptions) {
  const [option, setOption] = useState<string>(defaultOption);

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="w-auto text-center">
        <AlertDialogTitle>{action} recurring event</AlertDialogTitle>
        <AlertDialogDescription>
          Which event would you like to {action.toLowerCase()}?
        </AlertDialogDescription>
        <RadioGroup
          value={option}
          onValueChange={setOption}
          className="mt-3 gap-5"
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
