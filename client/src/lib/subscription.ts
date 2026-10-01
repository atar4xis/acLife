import type { ServerMetadata } from "@/types/ServerMetadata";
import type { User } from "@/types/User";

const ACTIVE_STATUSES = ["active", "trialing"];

export const hasActiveSubscription = (user: User | null) =>
  user?.type === "online" &&
  ACTIVE_STATUSES.includes(user.subscription_status ?? "");

export const isSubscriptionMissing = (
  user: User | null,
  serverMeta: ServerMetadata | null,
) =>
  user?.type === "online" &&
  !!serverMeta?.registration.subscriptionRequired &&
  !hasActiveSubscription(user);
