import { useState } from "react";
import { openExternal } from "@/lib/nativeUpdater";
import { isStripeUrl } from "@/lib/validators";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { useApi } from "@/context/ApiContext";
import { useUser } from "@/context/UserContext";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { sectionLabel, settingLabel } from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import Section from "../SettingsSection";
import { useTranslation } from "react-i18next";

function statusLabel(t: TFunction, status: string | null | undefined) {
  if (!status) return t("settings.subscription.none");
  return t(`settings.subscription.status.${status}`, {
    defaultValue: status.charAt(0).toUpperCase() + status.slice(1),
  });
}

export default function SubscriptionPage({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  const { t } = useTranslation();
  const { user } = useUser();
  const { get } = useApi();
  const [loading, setLoading] = useState(false);

  if (!user || user.type !== "online") return null;

  const openPortal = async () => {
    setLoading(true);
    const res = await get<string>("stripe/manage");
    setLoading(false);

    if (!res.success || !res.data || !isStripeUrl(res.data)) {
      toast.error(res.message || t("settings.subscription.portalFailed"));
      return;
    }

    openExternal(res.data);
  };

  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">
        {t("settings.categories.subscription")}
      </h2>

      <Section id="plan" label={sectionLabel("plan")} sectionRefs={sectionRefs}>
        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>{settingLabel("subscription-status")}</FieldTitle>
            <FieldDescription>
              {statusLabel(t, user.subscription_status)}
            </FieldDescription>
          </FieldContent>
        </Field>
        <div className="flex flex-col gap-1.5">
          <Field orientation="responsive">
            <FieldTitle>{settingLabel("subscription-manage")}</FieldTitle>
            <Button onClick={openPortal} disabled={loading} variant="outline">
              {t("settings.subscription.manage")}
            </Button>
          </Field>
          <FieldDescription>
            {t("settings.subscription.manageHelp")}
          </FieldDescription>
        </div>
      </Section>

      <Separator />

      <Section
        id="invoices"
        label={sectionLabel("invoices")}
        sectionRefs={sectionRefs}
      >
        <div className="flex flex-col gap-1.5">
          <Field orientation="responsive">
            <FieldTitle>{settingLabel("subscription-invoices")}</FieldTitle>
            <Button onClick={openPortal} disabled={loading} variant="outline">
              {t("settings.subscription.viewInvoices")}
            </Button>
          </Field>
          <FieldDescription>
            {t("settings.subscription.invoicesHelp")}
          </FieldDescription>
        </div>
      </Section>
    </FieldGroup>
  );
}
