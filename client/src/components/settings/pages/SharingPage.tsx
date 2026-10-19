import ContactCard from "@/components/sharing/ContactCard";
import FingerprintStep from "@/components/sharing/FingerprintStep";
import SecurityCode from "@/components/sharing/SecurityCode";
import SpaceIcon from "@/components/sharing/SpaceIcon";
import SpaceName from "@/components/sharing/SpaceName";
import MemberList from "@/components/sharing/MemberList";
import AddContactDialog from "@/components/sharing/AddContactDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldTitle } from "@/components/ui/field";
import IconButton from "@/components/ui/icon-button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { useShares } from "@/context/ShareContext";
import {
  useJoinedDescription,
  useOwnedDescription,
} from "@/hooks/useSpaceDescription";
import { useUser } from "@/context/UserContext";
import type { Permission, ReceivedShare } from "@/types/Share";
import {
  BookText,
  CalendarDays,
  Plus,
  Share2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { sectionLabel, settingLabel, settingLabelId } from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import SettingsLabel from "../SettingsLabel";
import Section from "../SettingsSection";

const kindLabel = (
  t: (key: string) => string,
  space: Pick<ReceivedShare, "kind" | "scope">,
) => t(`shares.kind.${space.kind}.${space.scope}`);

const permissionLabel = (t: (key: string) => string, permission: Permission) =>
  t(permission === "write" ? "shares.canEditLower" : "shares.canViewLower");

function InviteRow({ invite }: { invite: ReceivedShare }) {
  const { t } = useTranslation();
  const { trustOf, pinContact, respondToInvite, nameOf } = useShares();
  const [confirming, setConfirming] = useState(false);
  const contact = {
    uuid: invite.owner,
    email: invite.ownerEmail,
    publicKey: invite.ownerPublicKey,
  };
  const trustLevel = trustOf(contact);

  const accept = async () => {
    setConfirming(false);
    pinContact(contact);
    await respondToInvite(invite.id, true);
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <span className="flex min-w-0 items-center gap-2">
        <SpaceIcon kind={invite.kind} scope={invite.scope} />
        <span className="min-w-0 text-sm">
          {t("shares.inviteFrom", {
            email: nameOf(invite.owner, invite.ownerEmail),
            what: kindLabel(t, invite),
          })}{" "}
          <span className="text-muted-foreground text-xs">
            ({permissionLabel(t, invite.permission)})
          </span>
        </span>
      </span>
      <span className="flex w-full gap-2 sm:w-auto">
        <Button
          size="sm"
          className="flex-1 sm:flex-none"
          onClick={() =>
            trustLevel === "same" ? accept() : setConfirming(true)
          }
        >
          {t("shares.accept")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 sm:flex-none"
          onClick={() => respondToInvite(invite.id, false)}
        >
          {t("shares.decline")}
        </Button>
      </span>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("shares.acceptTitle")}</DialogTitle>
            <DialogDescription>
              {t("shares.acceptDescription", { email: invite.ownerEmail })}
            </DialogDescription>
          </DialogHeader>
          <FingerprintStep
            email={invite.ownerEmail}
            publicKey={invite.ownerPublicKey}
            trust={trustLevel}
            continueLabel={t("shares.accept")}
            onContinue={accept}
            onCancel={() => setConfirming(false)}
          />
        </DialogContent>
      </Dialog>
    </li>
  );
}

export default function SharingPage({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  const { t } = useTranslation();
  const {
    enabled,
    owned,
    joined,
    invites,
    contacts,
    removeContact,
    publicKey,
    openShare,
    removeMember,
    deleteSpace,
    trustOf,
    pinContact,
  } = useShares();
  const describeOwned = useOwnedDescription();
  const describeJoined = useJoinedDescription();
  const [addingContact, setAddingContact] = useState(false);
  const { inviteNotifications, setSetting } = useCalendarSettings();
  const { user: account } = useUser();
  const user = account?.type === "online" ? account : null;

  if (!enabled) {
    return (
      <FieldGroup className="gap-8">
        <h2 className="text-lg font-semibold">
          {t("settings.categories.sharing")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("shares.unavailable")}
        </p>
      </FieldGroup>
    );
  }

  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">
        {t("settings.categories.sharing")}
      </h2>

      <Section
        id="sharing-start"
        label={sectionLabel("sharing-start")}
        sectionRefs={sectionRefs}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() =>
              openShare({
                kind: "calendar",
                scope: "collection",
                target: null,
                label: t("shares.wholeCalendar"),
              })
            }
          >
            <CalendarDays />
            {settingLabel("sharing-calendar")}
          </Button>
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() =>
              openShare({
                kind: "journal",
                scope: "collection",
                target: null,
                label: t("shares.wholeJournal"),
              })
            }
          >
            <BookText />
            {settingLabel("sharing-journal")}
          </Button>
        </div>
      </Section>

      <Separator />

      <Section
        id="sharing-invites"
        label={sectionLabel("sharing-invites")}
        sectionRefs={sectionRefs}
      >
        <Field orientation="responsive" className="min-h-9">
          <SettingsLabel settingKey="inviteNotifications" />
          <Switch
            aria-labelledby={settingLabelId("inviteNotifications")}
            checked={inviteNotifications}
            onCheckedChange={(checked) =>
              setSetting("inviteNotifications", checked)
            }
          />
        </Field>
        {invites.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("shares.noInvites")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {invites.map((invite) => (
              <InviteRow key={invite.id} invite={invite} />
            ))}
          </ul>
        )}
      </Section>

      <Separator />

      <Section
        id="sharing-owned"
        label={sectionLabel("sharing-owned")}
        sectionRefs={sectionRefs}
      >
        {owned.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("shares.nothingShared")}
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {owned.map((space) => {
              const description = describeOwned(space);
              return (
                <li key={space.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <SpaceName description={description} />
                    <IconButton
                      label={t("shares.shareAction")}
                      size="icon-sm"
                      onClick={() =>
                        openShare({
                          kind: space.kind,
                          scope: space.scope,
                          target: space.target,
                          label: description.name,
                        })
                      }
                    >
                      <Share2 />
                    </IconButton>
                    <IconButton
                      label={t("shares.stopSharing")}
                      size="icon-sm"
                      onClick={() => deleteSpace(space.id)}
                    >
                      <X />
                    </IconButton>
                  </div>
                  <MemberList space={space} className="flex flex-col gap-2" />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Separator />

      <Section
        id="sharing-joined"
        label={sectionLabel("sharing-joined")}
        sectionRefs={sectionRefs}
      >
        {joined.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("shares.nothingReceived")}
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
            {joined.map((space) => (
              <li key={space.id} className="overflow-hidden rounded-lg border">
                <div className="bg-muted/40 flex items-center justify-between gap-2 p-2">
                  <SpaceName description={describeJoined(space)} />
                  <IconButton
                    label={t("shares.leave")}
                    size="icon-sm"
                    onClick={() => user && removeMember(space.id, user.uuid)}
                  >
                    <X />
                  </IconButton>
                </div>
                <div className="p-2">
                  <ContactCard
                    mini
                    contact={{ uuid: space.owner, email: space.ownerEmail }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Separator />

      <Section
        id="sharing-contacts"
        label={sectionLabel("sharing-contacts")}
        action={
          <IconButton
            label={t("shares.addContact")}
            size="icon-sm"
            onClick={() => setAddingContact(true)}
          >
            <Plus />
          </IconButton>
        }
        sectionRefs={sectionRefs}
      >
        {publicKey && (
          <div className="bg-muted/40 flex flex-col gap-1 rounded-lg border p-3">
            <FieldTitle>{settingLabel("sharing-code")}</FieldTitle>
            <SecurityCode publicKey={publicKey} />
          </div>
        )}
        {contacts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("shares.noContacts")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {contacts.map((contact) => (
              <li key={contact.uuid}>
                <ContactCard
                  contact={contact}
                  action={
                    contact.removable && (
                      <IconButton
                        label={t("shares.removeContact", {
                          email: contact.email,
                        })}
                        size="icon-sm"
                        onClick={() => removeContact(contact.uuid)}
                      >
                        <X />
                      </IconButton>
                    )
                  }
                >
                  {trustOf(contact) === "changed" && (
                    <div className="text-warning flex flex-wrap items-center gap-2 text-xs">
                      <TriangleAlert className="size-3.5 shrink-0" />
                      {t("shares.codeChangedWarning", { email: contact.email })}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => pinContact(contact)}
                      >
                        {t("shares.trustNewCode")}
                      </Button>
                    </div>
                  )}
                </ContactCard>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <AddContactDialog open={addingContact} onOpenChange={setAddingContact} />
    </FieldGroup>
  );
}
