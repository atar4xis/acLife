import { useState } from "react";
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

function statusLabel(status: string | null | undefined) {
  if (!status) return "No active subscription";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function SubscriptionPage({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  const { user } = useUser();
  const { get } = useApi();
  const [loading, setLoading] = useState(false);

  if (!user || user.type !== "online") return null;

  const openPortal = async () => {
    setLoading(true);
    const res = await get<string>("stripe/manage");
    setLoading(false);

    if (!res.success || !res.data) {
      toast.error(res.message || "Failed to open billing portal.");
      return;
    }

    window.open(res.data, "_blank", "noopener");
  };

  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">Subscription</h2>

      <Section id="plan" label={sectionLabel("plan")} sectionRefs={sectionRefs}>
        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>{settingLabel("subscription-status")}</FieldTitle>
            <FieldDescription>
              {statusLabel(user.subscription_status)}
            </FieldDescription>
          </FieldContent>
        </Field>
        <div className="flex flex-col gap-1.5">
          <Field orientation="responsive">
            <FieldTitle>{settingLabel("subscription-manage")}</FieldTitle>
            <Button onClick={openPortal} disabled={loading} variant="outline">
              Manage
            </Button>
          </Field>
          <FieldDescription>
            Change plan, update payment details, or cancel your subscription
            via Stripe.
          </FieldDescription>
        </div>
      </Section>

      <Separator />

      <Section id="invoices" label={sectionLabel("invoices")} sectionRefs={sectionRefs}>
        <div className="flex flex-col gap-1.5">
          <Field orientation="responsive">
            <FieldTitle>{settingLabel("subscription-invoices")}</FieldTitle>
            <Button onClick={openPortal} disabled={loading} variant="outline">
              View invoices
            </Button>
          </Field>
          <FieldDescription>
            View and download past invoices via the Stripe billing portal.
          </FieldDescription>
        </div>
      </Section>
    </FieldGroup>
  );
}
