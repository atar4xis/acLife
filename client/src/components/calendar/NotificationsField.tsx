import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EventNotification } from "@/types/calendar/Event";
import {
  MAX_EVENT_NOTIFICATIONS,
  MAX_NOTIFY_AMOUNT,
  NOTIFY_METHODS,
  NOTIFY_WHEN,
} from "@/lib/calendar/notifications";
import { useStorage } from "@/context/StorageContext";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

type FieldProps = {
  value: EventNotification[];
  onChange: (value: EventNotification[]) => void;
};

export function AddNotificationButton({
  value,
  onChange,
  className,
}: FieldProps & { className?: string }) {
  const { t } = useTranslation();

  if (value.length >= MAX_EVENT_NOTIFICATIONS) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn("size-6", className)}
      aria-label={t("notify.add")}
      onClick={() =>
        onChange([...value, { when: "start", amount: 10, method: "sound" }])
      }
    >
      <Plus />
    </Button>
  );
}

export default function NotificationsField({ value, onChange }: FieldProps) {
  const { t } = useTranslation();
  const pushEnabled = !!useStorage().get("pushSubscription");

  const patch = (index: number, changes: Partial<EventNotification>) =>
    onChange(value.map((n, i) => (i === index ? { ...n, ...changes } : n)));

  if (!value.length) return null;

  return (
    <div className="flex flex-col gap-2">
      {value.map((n, i) => (
        <div
          key={i}
          className="relative flex flex-col gap-2 rounded-lg border p-2 pe-10"
        >
          <div className="flex items-center gap-2">
            {n.when !== "start" && (
              <Input
                type="number"
                className="w-20 shrink-0"
                min={1}
                max={MAX_NOTIFY_AMOUNT}
                aria-label={t("notify.amount")}
                value={n.amount || ""}
                onChange={(e) =>
                  patch(i, {
                    amount: Math.min(
                      MAX_NOTIFY_AMOUNT,
                      Math.round(e.target.valueAsNumber) || 0,
                    ),
                  })
                }
                onBlur={() => n.amount < 1 && patch(i, { amount: 1 })}
              />
            )}
            <Select
              value={n.when}
              onValueChange={(when) =>
                patch(i, { when: when as EventNotification["when"] })
              }
            >
              <SelectTrigger
                className="min-w-0 flex-1"
                aria-label={t("notify.when")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTIFY_WHEN.map((when) => (
                  <SelectItem key={when} value={when}>
                    {t(`notify.whenOptions.${when}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Select
            value={n.method}
            onValueChange={(method) =>
              patch(i, { method: method as EventNotification["method"] })
            }
          >
            <SelectTrigger className="w-full" aria-label={t("notify.how")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTIFY_METHODS.map((method) => (
                <SelectItem
                  key={method}
                  value={method}
                  disabled={method !== "sound" && !pushEnabled}
                >
                  {t(`notify.methodOptions.${method}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute inset-e-1 top-1"
            aria-label={t("notify.remove")}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X />
          </Button>
        </div>
      ))}
    </div>
  );
}
