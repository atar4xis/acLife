import { describe, expect, it } from "vitest";
import { isStripeUrl } from "../../src/lib/validators.ts";

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
