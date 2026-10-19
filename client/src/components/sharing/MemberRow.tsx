import ContactCard from "@/components/sharing/ContactCard";
import PermissionSelect from "@/components/sharing/PermissionSelect";
import { useShares } from "@/context/ShareContext";
import type { Permission, ShareMember } from "@/types/Share";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export default function MemberRow({
  member,
  onPermission,
  children,
}: {
  member: ShareMember;
  onPermission: (permission: Permission) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { nameOf } = useShares();

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
      <ContactCard
        mini
        contact={{ uuid: member.user, email: member.email }}
        badge={member.status === "pending" ? t("shares.pending") : undefined}
      />
      <span className="ms-8 flex shrink-0 items-center gap-1 sm:ms-0">
        <PermissionSelect
          value={member.permission}
          onChange={onPermission}
          label={t("shares.permissionOf", {
            email: nameOf(member.user, member.email),
          })}
        />
        {children}
      </span>
    </li>
  );
}
