import MemberRow from "@/components/sharing/MemberRow";
import IconButton from "@/components/ui/icon-button";
import { useShares } from "@/context/ShareContext";
import type { OwnedSpace } from "@/types/Share";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function MemberList({
  space,
  className,
}: {
  space: OwnedSpace;
  className: string;
}) {
  const { t } = useTranslation();
  const { setPermission, removeMember, nameOf } = useShares();

  return (
    <ul className={className}>
      {space.members.map((member) => (
        <MemberRow
          key={member.user}
          member={member}
          onPermission={(next) => setPermission(space.id, member.user, next)}
        >
          <IconButton
            label={t("shares.removePerson", {
              email: nameOf(member.user, member.email),
            })}
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            onClick={() => removeMember(space.id, member.user)}
          >
            <Trash2 />
          </IconButton>
        </MemberRow>
      ))}
    </ul>
  );
}
