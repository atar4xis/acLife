import { describe, expect, it } from "vitest";
import {
  hasActiveSubscription,
  isSubscriptionMissing,
} from "@/lib/subscription";
import type { ServerMetadata } from "@/types/ServerMetadata";
import type { User } from "@/types/User";

const online = (subscription_status: string | null) =>
  ({ type: "online", subscription_status }) as User;
const meta = (subscriptionRequired: boolean) =>
  ({ registration: { subscriptionRequired } }) as ServerMetadata;

describe("subscription helpers", () => {
  it("treats active and trialing as an active subscription", () => {
    expect(hasActiveSubscription(online("active"))).toBe(true);
    expect(hasActiveSubscription(online("trialing"))).toBe(true);
    expect(hasActiveSubscription(online("canceled"))).toBe(false);
    expect(hasActiveSubscription(online(null))).toBe(false);
    expect(hasActiveSubscription({ type: "offline" })).toBe(false);
    expect(hasActiveSubscription(null)).toBe(false);
  });

  it("is missing only when required and not active for an online user", () => {
    expect(isSubscriptionMissing(online(null), meta(true))).toBe(true);
    expect(isSubscriptionMissing(online("active"), meta(true))).toBe(false);
    expect(isSubscriptionMissing(online(null), meta(false))).toBe(false);
    expect(isSubscriptionMissing(online(null), null)).toBe(false);
    expect(isSubscriptionMissing({ type: "offline" }, meta(true))).toBe(false);
    expect(isSubscriptionMissing(null, meta(true))).toBe(false);
  });
});
