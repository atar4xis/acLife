import { describe, expect, it } from "vitest";
import { isStripeUrl, validateServerMeta } from "@/lib/validators";
import type { ServerMetadata } from "@/types/ServerMetadata";

const meta = {
  url: "https://mock.example/api",
  policies: {},
  registration: { enabled: true, subscriptionRequired: false },
  vapidPublicKey: "",
  sessionSeconds: 259200,
} as ServerMetadata;

describe("validateServerMeta", () => {
  it("accepts the session length", () => {
    expect(validateServerMeta(meta)).toBe(true);
  });

  it("accepts metadata without a session length", () => {
    expect(
      validateServerMeta({ ...meta, sessionSeconds: undefined }),
    ).toBe(true);
  });

  it("rejects a session length that is not a number", () => {
    expect(
      validateServerMeta({ ...meta, sessionSeconds: "3" } as never),
    ).toBe(false);
  });
});


describe("isStripeUrl", () => {
  it.each([
    "https://checkout.stripe.com/c/pay/cs_test_1",
    "https://billing.stripe.com/p/session/test_1",
  ])("accepts %s", (url) => {
    expect(isStripeUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://checkout.stripe.com/c/pay/x",
    "https://stripe.com/x",
    "https://checkout.stripe.com.evil.example/x",
    "https://evil.example/checkout.stripe.com",
    "https://checkout.stripe.com@evil.example/x",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(isStripeUrl(url)).toBe(false);
  });
});
