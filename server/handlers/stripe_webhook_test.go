package handlers_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"testing"
	"time"

	"acLife/database"
	"acLife/internal/testutil"
)

const webhookSecret = "whsec_test_secret"

func signedWebhook(t *testing.T, c *testutil.Client, payload string, mods ...func(*http.Request)) int {
	t.Helper()

	ts := time.Now().Unix()
	mac := hmac.New(sha256.New, []byte(webhookSecret))
	_, _ = fmt.Fprintf(mac, "%d.%s", ts, payload)
	header := fmt.Sprintf("t=%d,v1=%s", ts, hex.EncodeToString(mac.Sum(nil)))

	mods = append(mods, withoutOrigin, func(r *http.Request) { r.Header.Set("Stripe-Signature", header) })
	resp, _ := c.Do("POST", "/stripe/webhook", []byte(payload), mods...)
	return resp.StatusCode
}

func subscriptionEvent(eventType, subID, status string) string {
	return fmt.Sprintf(`{"id":"evt_1","object":"event","type":%q,"data":{"object":{"id":%q,"status":%q}}}`, eventType, subID, status)
}

func subscriptionStatus(t *testing.T, uuid string) string {
	t.Helper()

	var status string
	if err := database.DB.QueryRow("SELECT subscription_status FROM users WHERE uuid = ?", uuid).Scan(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

func TestStripeWebhookUpdatesSubscriptionStatus(t *testing.T) {
	testutil.RequireDB(t)
	t.Setenv("STRIPE_WEBHOOK_SECRET", webhookSecret)

	for _, eventType := range []string{"customer.subscription.updated", "customer.subscription.deleted"} {
		t.Run(eventType, func(t *testing.T) {
			c := testutil.NewClient(t)
			user := testutil.NewUser(t, testutil.Subscribed("active"))
			bystander := testutil.NewUser(t, testutil.Subscribed("active"))

			if status := signedWebhook(t, c, subscriptionEvent(eventType, user.SubscriptionID, "canceled")); status != http.StatusOK {
				t.Fatalf("got %d", status)
			}
			if got := subscriptionStatus(t, user.UUID); got != "canceled" {
				t.Fatalf("status %q", got)
			}
			if got := subscriptionStatus(t, bystander.UUID); got != "active" {
				t.Fatalf("other user's status changed to %q", got)
			}
		})
	}
}

func TestStripeWebhookRejectsBadSignatures(t *testing.T) {
	testutil.RequireDB(t)
	t.Setenv("STRIPE_WEBHOOK_SECRET", webhookSecret)
	user := testutil.NewUser(t, testutil.Subscribed("active"))
	payload := subscriptionEvent("customer.subscription.deleted", user.SubscriptionID, "canceled")

	cases := map[string]func(*http.Request){
		"missing":   withoutOrigin,
		"garbage":   func(r *http.Request) { r.Header.Set("Stripe-Signature", "t=1,v1=abc") },
		"wrong key": func(r *http.Request) { r.Header.Set("Stripe-Signature", forgedSignature(payload, "whsec_other")) },
		"stale": func(r *http.Request) {
			r.Header.Set("Stripe-Signature", forgedSignatureAt(payload, webhookSecret, time.Now().Add(-time.Hour)))
		},
	}
	for name, mod := range cases {
		t.Run(name, func(t *testing.T) {
			c := testutil.NewClient(t)

			resp, _ := c.Do("POST", "/stripe/webhook", []byte(payload), mod)
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("got %d", resp.StatusCode)
			}
			if got := subscriptionStatus(t, user.UUID); got != "active" {
				t.Fatalf("status changed to %q", got)
			}
		})
	}
}

func forgedSignature(payload, secret string) string {
	return forgedSignatureAt(payload, secret, time.Now())
}

func forgedSignatureAt(payload, secret string, at time.Time) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = fmt.Fprintf(mac, "%d.%s", at.Unix(), payload)
	return fmt.Sprintf("t=%d,v1=%s", at.Unix(), hex.EncodeToString(mac.Sum(nil)))
}

func TestStripeWebhookRejectsTamperedPayload(t *testing.T) {
	testutil.RequireDB(t)
	t.Setenv("STRIPE_WEBHOOK_SECRET", webhookSecret)
	c := testutil.NewClient(t)
	user := testutil.NewUser(t, testutil.Subscribed("active"))

	signed := subscriptionEvent("customer.subscription.updated", user.SubscriptionID, "active")
	tampered := subscriptionEvent("customer.subscription.updated", user.SubscriptionID, "canceled")

	resp, _ := c.Do("POST", "/stripe/webhook", []byte(tampered), withoutOrigin, func(r *http.Request) {
		r.Header.Set("Stripe-Signature", forgedSignature(signed, webhookSecret))
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("got %d", resp.StatusCode)
	}
	if got := subscriptionStatus(t, user.UUID); got != "active" {
		t.Fatalf("status changed to %q", got)
	}
}

func TestStripeWebhookUnavailableWithoutSecret(t *testing.T) {
	c := testutil.NewClient(t)

	resp, _ := c.Do("POST", "/stripe/webhook", []byte("{}"), withoutOrigin)
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("got %d", resp.StatusCode)
	}
}

func TestStripeWebhookCheckoutCompletedRequiresUserSubscriptionAndCustomer(t *testing.T) {
	testutil.RequireDB(t)
	t.Setenv("STRIPE_WEBHOOK_SECRET", webhookSecret)
	user := testutil.NewUser(t)

	cases := map[string]string{
		"no user":         `{"metadata":{},"subscription":"sub_1","customer":"cus_1"}`,
		"no subscription": fmt.Sprintf(`{"metadata":{"aclUserId":%q},"customer":"cus_1"}`, user.UUID),
		"no customer":     fmt.Sprintf(`{"metadata":{"aclUserId":%q},"subscription":"sub_1"}`, user.UUID),
	}
	for name, object := range cases {
		t.Run(name, func(t *testing.T) {
			c := testutil.NewClient(t)
			payload := `{"id":"evt_1","object":"event","type":"checkout.session.completed","data":{"object":` + object + `}}`

			if status := signedWebhook(t, c, payload); status != http.StatusBadRequest {
				t.Fatalf("got %d", status)
			}
			if n := count(t, "SELECT COUNT(*) FROM users WHERE uuid = ? AND stripe_subscription_id IS NOT NULL", user.UUID); n != 0 {
				t.Fatal("subscription stored")
			}
		})
	}
}
