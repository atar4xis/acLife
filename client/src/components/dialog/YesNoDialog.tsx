import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import type { WithChildren } from "@/types/Props";
import { useTranslation } from "react-i18next";

type YesNoDialogProps = {
  open: boolean;
  disabled?: boolean;
  title: ReactNode;
  description?: ReactNode;
  yesText?: string;
  noText?: string;
  cancelText?: string;
  onYes?: () => void;
  onNo?: () => void;
  onCancel?: () => void;
};

export default function YesNoDialog({
  open,
  disabled,
  title,
  description,
  yesText,
  noText,
  cancelText,
  onYes,
  onNo,
  onCancel,
  children,
}: YesNoDialogProps & WithChildren) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {description && (
          <AlertDialogDescription>{children}</AlertDialogDescription>
        )}
        {children}
        <AlertDialogFooter>
          <div className="flex justify-between w-full">
            <AlertDialogCancel onClick={onCancel} disabled={disabled}>
              {cancelText || t("common.cancel")}
            </AlertDialogCancel>
            <div className="flex gap-2">
              <AlertDialogCancel onClick={onNo} disabled={disabled}>
                {noText || t("common.no")}
              </AlertDialogCancel>
              <AlertDialogAction onClick={onYes} disabled={disabled}>
                {yesText || t("common.yes")}
              </AlertDialogAction>
            </div>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
