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
import { useEffect, useState } from "react";
import type { Price } from "@/types/Subscription";
import { Skeleton } from "../ui/skeleton";
import { toast } from "sonner";

export default function SubscriptionDialog() {
  const { user, logout, checkLogin } = useUser();
  const { get, post } = useApi();
  const [prices, setPrices] = useState<Price[] | null>(null);
  const [loading, setLoading] = useState(false);

  const dialogTitle = "Select Subscription";

  const fetchPricing = async () => {
    const res = await get<Price[]>("stripe/pricing");

    if (!res.success || !res.data) {
      toast.error("Failed to load pricing");
      return;
    }

    const sorted = res.data.sort((a, b) => a.amount - b.amount);
    setPrices(sorted);
  };

  useEffect(() => {
    fetchPricing();
  }, []);

  const handlePurchase = async (priceId: string) => {
    setLoading(true);
    const res = await post<string>("stripe/checkout", { priceId });

    if (!res.success || !res.data) {
      toast.error("Failed to create checkout.");
      setLoading(false);
      return;
    }

    window.location.href = res.data;
  };

  const recheck = async () => {
    setLoading(true);
    const newUser = await checkLogin();

    if (
      newUser &&
      newUser.type === "online" &&
      newUser.subscription_status === "active"
    ) {
      toast.success("Payment confirmed.");
    } else {
      toast.warning("It doesn't look like you paid yet.");
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
                per {price.billingPeriod}
              </span>
            </div>

            <Button
              className="w-full mt-8"
              disabled={loading}
              onClick={() => handlePurchase(price.id)}
            >
              Select
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
          <DialogTitle className="text-center">{dialogTitle}</DialogTitle>
          <DialogDescription className="text-center">
            The server you are logged into requires an active subscription.
            <br />
            Select one of the following options.
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
          I already paid
        </Button>

        <Button
          className="w-full"
          variant="ghost"
          onClick={logout}
          disabled={loading}
        >
          Log out
        </Button>
      </DialogContent>
    </Dialog>
  );
}
