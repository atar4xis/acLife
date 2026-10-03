import { Card, CardContent } from "../ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useUser } from "@/context/UserContext";
import { Button } from "../ui/button";
import { useApi } from "@/context/ApiContext";
import { formatPrice } from "@/lib/utils";
import { hasActiveSubscription } from "@/lib/subscription";
import { useCallback, useEffect, useState } from "react";
import type { Price } from "@/types/Subscription";
import { Skeleton } from "../ui/skeleton";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export default function SubscriptionDialog() {
  const { t } = useTranslation();
  const { user, logout, checkLogin } = useUser();
  const { get, post } = useApi();
  const [prices, setPrices] = useState<Price[] | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPricing = useCallback(async () => {
    const res = await get<Price[]>("stripe/pricing");

    if (!res.success || !res.data) {
      toast.error(t("subscription.pricingFailed"));
      return;
    }

    const sorted = res.data.sort((a, b) => a.amount - b.amount);
    setPrices(sorted);
  }, [get, t]);

  useEffect(() => {
    fetchPricing();
  }, [fetchPricing]);

  const handlePurchase = async (priceId: string) => {
    setLoading(true);
    const res = await post<string>("stripe/checkout", { priceId });

    if (!res.success || !res.data) {
      toast.error(t("subscription.checkoutFailed"));
      setLoading(false);
      return;
    }

    window.location.href = res.data;
  };

  const recheck = async () => {
    setLoading(true);
    const newUser = await checkLogin();

    if (hasActiveSubscription(newUser || null)) {
      toast.success(t("subscription.paymentConfirmed"));
    } else {
      toast.warning(t("subscription.notPaid"));
    }

    setLoading(false);
  };

  const planCards =
    prices &&
    prices.map((price) => {
      const formattedPrice = formatPrice(price.currency, price.amount);

      return (
        <Card key={price.id} className="flex flex-col w-48">
          <CardContent className="flex flex-col items-center gap-4">
            <div className="text-center">
              <div className="text-4xl font-semibold">{formattedPrice}</div>
              <span className="text-sm text-muted-foreground">
                {t(`subscription.per.${price.billingPeriod}`, {
                  defaultValue: t("subscription.per.other", {
                    period: price.billingPeriod,
                  }),
                })}
              </span>
            </div>

            <Button
              className="w-full mt-8"
              disabled={loading}
              onClick={() => handlePurchase(price.id)}
            >
              {t("subscription.select")}
            </Button>
          </CardContent>
        </Card>
      );
    });

  if (!user || user.type != "online") return null;

  return (
    <Dialog open>
      <DialogContent showCloseButton={false} className="w-auto !max-w-[90vw]">
        <DialogHeader>
          <DialogTitle className="text-center">
            {t("subscription.title")}
          </DialogTitle>
          <DialogDescription className="text-center">
            {t("subscription.required")}
            <br />
            {t("subscription.selectOption")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-4 justify-center my-5 flex-wrap">
          {prices ? (
            planCards
          ) : (
            <>
              <Skeleton className="h-48 w-48" />
              <Skeleton className="h-48 w-48" />
            </>
          )}
        </div>
        <Button
          className="w-full"
          variant="outline"
          onClick={recheck}
          disabled={loading}
        >
          {t("subscription.alreadyPaid")}
        </Button>

        <Button
          className="w-full"
          variant="ghost"
          onClick={logout}
          disabled={loading}
        >
          {t("user.logout")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
