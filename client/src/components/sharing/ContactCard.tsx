import RenameInput from "@/components/journal/RenameInput";
import SecurityCode from "@/components/sharing/SecurityCode";
import { Button } from "@/components/ui/button";
import { useShares } from "@/context/ShareContext";
import { MAX_NICKNAME_LENGTH } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Pencil, User } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

type Person = { uuid: string; email: string; publicKey?: string };

function Avatar({ mini }: { mini?: boolean }) {
  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-full",
        mini ? "size-6" : "size-9",
      )}
    >
      <User className={mini ? "size-3.5" : "size-5"} />
    </span>
  );
}

function EditableName({ contact }: { contact: Person }) {
  const { t } = useTranslation();
  const { nicknames, setNickname } = useShares();
  const [editing, setEditing] = useState(false);
  const nickname = nicknames[contact.uuid];
  const shown = nickname ?? contact.email;

  if (editing) {
    return (
      <div className="bg-accent flex min-w-0 items-center rounded-md px-1.5 py-0.5 text-sm">
        <RenameInput
          name={shown}
          label={t("shares.nickname")}
          maxLength={MAX_NICKNAME_LENGTH}
          onDone={(value) => {
            setEditing(false);
            if (value === undefined || value === shown) return;

            setNickname(contact.uuid, value === contact.email ? "" : value);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex items-center gap-1">
        <span className="truncate text-sm">{shown}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6"
          aria-label={t("shares.editNickname", { email: contact.email })}
          onClick={() => setEditing(true)}
        >
          <Pencil />
        </Button>
      </span>
      {nickname && (
        <span className="text-muted-foreground truncate text-xs">
          {contact.email}
        </span>
      )}
    </div>
  );
}

export default function ContactCard({
  contact,
  mini,
  badge,
  action,
  children,
}: {
  contact: Person;
  mini?: boolean;
  badge?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { nicknames } = useShares();
  const nickname = nicknames[contact.uuid];

  if (mini) {
    return (
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <Avatar mini />
        <span className="flex min-w-0 flex-col sm:flex-row sm:items-center sm:gap-1">
          <span className="flex min-w-0 items-center gap-2 sm:contents">
            <span className="truncate">{nickname ?? contact.email}</span>
            {badge && (
              <span className="text-muted-foreground shrink-0 text-xs sm:order-last sm:ms-1">
                {badge}
              </span>
            )}
          </span>
          {nickname && (
            <>
              {" "}
              <span className="text-muted-foreground truncate">
                ({contact.email})
              </span>
            </>
          )}
        </span>
      </span>
    );
  }

  return (
    <div className="rounded-lg border p-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-3 max-sm:order-1">
          <Avatar />
          <EditableName contact={contact} />
        </div>
        <div className="ms-auto flex items-center gap-2 max-sm:contents">
          {contact.publicKey && (
            <SecurityCode
              publicKey={contact.publicKey}
              className="text-muted-foreground text-xs sm:translate-y-0.5 max-sm:order-3 max-sm:ms-12 max-sm:w-full"
            />
          )}
          <span className="flex max-sm:order-2 max-sm:ms-auto">{action}</span>
        </div>
      </div>
      {children && (
        <div className="ms-12 mt-1 flex flex-col gap-1">{children}</div>
      )}
    </div>
  );
}
