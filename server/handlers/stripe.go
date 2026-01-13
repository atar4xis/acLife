package handlers

import (
	"io"
	"net/http"
	"os"
	"time"

	"acLife/database"
	aclSession "acLife/session"
	"acLife/types"
	"acLife/utils"

	"github.com/stripe/stripe-go/v84"
	portal "github.com/stripe/stripe-go/v84/billingportal/session"
	"github.com/stripe/stripe-go/v84/checkout/session"
	"github.com/stripe/stripe-go/v84/price"
	"github.com/stripe/stripe-go/v84/webhook"
)

// Pricing gets the subscription prices from Stripe.
func Pricing(w http.ResponseWriter, r *http.Request) {
	stripe.Key = os.Getenv("STRIPE_API_KEY")
	productID := os.Getenv("STRIPE_PRODUCT_ID")

	params := &stripe.PriceListParams{
		Product: stripe.String(productID),
		Active:  stripe.Bool(true),
		ListParams: stripe.ListParams{
			Limit: stripe.Int64(3),
		},
	}

	iter := price.List(params)

	var prices []types.Price
	for iter.Next() {
		p := iter.Price()

		if p.Recurring == nil {
			continue // skip one-time prices
		}

		prices = append(prices, types.Price{
			ID:            p.ID,
			Amount:        int(p.UnitAmount),
			Currency:      string(p.Currency),
			BillingPeriod: string(p.Recurring.Interval),
		})
	}

	if err := iter.Err(); err != nil {
		utils.LogError("Pricing", "iter", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[[]types.Price]{
		Success: true,
		Data:    prices,
	})
}

// CreatePortalSession creates a Stripe Customer Portal session and returns the URL.
func CreatePortalSession(w http.ResponseWriter, r *http.Request) {
	stripe.Key = os.Getenv("STRIPE_API_KEY")

	user := aclSession.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	if user.StripeCustomerID == nil || *user.StripeCustomerID == "" {
		utils.SendBadRequest(w)
		return
	}

	params := &stripe.BillingPortalSessionParams{
		Customer:  stripe.String(*user.StripeCustomerID),
		ReturnURL: stripe.String(os.Getenv("CLIENT_URL")),
	}

	sess, err := portal.New(params)
	if err != nil {
		utils.LogError("CreatePortalSession", "portal.New", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[string]{
		Success: true,
		Data:    sess.URL,
	})
}

// CreateCheckoutSession creates a Stripe Checkout Session and returns the URL.
func CreateCheckoutSession(w http.ResponseWriter, r *http.Request) {
	user := aclSession.GetLoggedInUser(r)
	utils.Assert(user != nil) // ensured by AuthMiddleware

	stripe.Key = os.Getenv("STRIPE_API_KEY")

	var req struct {
		PriceID string `json:"priceId"`
	}
	if err := utils.ParseJSON(r.Body, &req); err != nil {
		utils.SendBadRequest(w)
		return
	}

	sess, err := session.New(&stripe.CheckoutSessionParams{
		Mode: stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(req.PriceID),
				Quantity: stripe.Int64(1),
			},
		},
		SuccessURL: stripe.String(os.Getenv("CLIENT_URL")),
		CancelURL:  stripe.String(os.Getenv("CLIENT_URL")),
		// Include the user's UUID in the metadata for later lookup
		Metadata: map[string]string{
			"aclUserId": user.UUID,
		},
	})
	if err != nil {
		utils.LogError("CreateCheckoutSession", "New", err)
		utils.SendInternalError(w)
		return
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[string]{
		Success: true,
		Data:    sess.URL,
	})
}

// StripeWebhook is used by the Stripe webhook to receive events.
func StripeWebhook(w http.ResponseWriter, r *http.Request) {
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	endpointSecret := os.Getenv("STRIPE_WEBHOOK_SECRET")
	sigHeader := r.Header.Get("Stripe-Signature")

	event, err := webhook.ConstructEventWithOptions(payload, sigHeader, endpointSecret,
		webhook.ConstructEventOptions{
			IgnoreAPIVersionMismatch: os.Getenv("ENV") != "production",
		},
	)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		utils.LogError("StripeWebhook", "ConstructEventWithOptions", err)
		return
	}

	obj := event.Data.Object

	switch event.Type {
	case "checkout.session.completed":
		metadata, _ := obj["metadata"].(map[string]any)

		aclUserID, _ := metadata["aclUserId"].(string)

		subID, _ := obj["subscription"].(string)
		cusID, _ := obj["customer"].(string)

		if aclUserID == "" || subID == "" || cusID == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		// Update database
		ctx := r.Context()
		if _, err := database.Exec(ctx, `
        UPDATE users SET
            stripe_customer_id=?,
            stripe_subscription_id=?
        WHERE uuid=?`,
			cusID, subID, aclUserID,
		); err != nil {
			utils.LogError("StripeWebhook", "database.Exec", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Schedule a status update
		time.AfterFunc(5*time.Second, func() {
			_ = database.UpdateSubscriptionStatus(subID)
		})
	case "customer.subscription.updated":
	case "customer.subscription.deleted":
		subID, _ := obj["id"].(string)
		status, _ := obj["status"].(string)

		if err := database.UpdateSubscriptionStatus(subID, status); err != nil {
			utils.LogError("StripeWebhook", "UpdateSubscriptionStatus", err)
		}
	}

	w.WriteHeader(http.StatusOK)
}
