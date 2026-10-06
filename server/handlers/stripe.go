package handlers

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"net/http"
	"os"
	"sync"
	"time"

	"acLife/constants"
	"acLife/database"
	aclSession "acLife/session"
	"acLife/stream"
	"acLife/types"
	"acLife/utils"

	"github.com/stripe/stripe-go/v84"
	portal "github.com/stripe/stripe-go/v84/billingportal/session"
	"github.com/stripe/stripe-go/v84/checkout/session"
	"github.com/stripe/stripe-go/v84/price"
	"github.com/stripe/stripe-go/v84/webhook"
)

var pricingCache struct {
	mu      sync.Mutex
	prices  []types.Price
	fetched time.Time
}

// Pricing gets the subscription prices from Stripe, answering from a short-lived cache so users cannot spend the API quota.
func Pricing(w http.ResponseWriter, r *http.Request) {
	pricingCache.mu.Lock()
	defer pricingCache.mu.Unlock()

	if pricingCache.prices == nil || time.Since(pricingCache.fetched) > constants.StripePricingCacheTTL {
		prices, err := listPrices()
		if err != nil {
			utils.LogError("Pricing", "iter", err)
			utils.SendInternalError(w)
			return
		}

		pricingCache.prices, pricingCache.fetched = prices, time.Now()
	}

	utils.SendJSON(w, http.StatusOK, types.Reply[[]types.Price]{
		Success: true,
		Data:    pricingCache.prices,
	})
}

func fetchPrices() ([]types.Price, error) {
	stripe.Key = os.Getenv("STRIPE_API_KEY")
	productID := os.Getenv("STRIPE_PRODUCT_ID")

	params := &stripe.PriceListParams{
		Product: stripe.String(productID),
		Active:  stripe.Bool(true),
		ListParams: stripe.ListParams{
			Limit: stripe.Int64(3),
		},
	}

	prices := []types.Price{}
	iter := price.List(params)
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

	return prices, iter.Err()
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

	if hasActiveSubscription(user.SubscriptionStatus) {
		utils.SendJSON(w, http.StatusConflict, types.Reply[any]{
			Success: false,
			Message: "You already have a subscription.",
			Code:    "already_subscribed",
		})
		return
	}

	p, err := getPrice(req.PriceID, nil)
	if err != nil {
		var stripeErr *stripe.Error
		if errors.As(err, &stripeErr) && stripeErr.HTTPStatusCode == http.StatusNotFound {
			utils.SendBadRequest(w)
			return
		}

		utils.LogError("CreateCheckoutSession", "price.Get", err)
		utils.SendInternalError(w)
		return
	}

	if !p.Active || p.Product == nil || p.Product.ID != os.Getenv("STRIPE_PRODUCT_ID") {
		utils.SendBadRequest(w)
		return
	}

	sess, err := createCheckout(&stripe.CheckoutSessionParams{
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

var (
	updateSubscriptionStatus = database.UpdateSubscriptionStatus
	listPrices               = fetchPrices
	getPrice                 = price.Get
	createCheckout           = session.New
)

// StripeWebhook is used by the Stripe webhook to receive events.
func StripeWebhook(w http.ResponseWriter, r *http.Request) {
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	endpointSecret := os.Getenv("STRIPE_WEBHOOK_SECRET")
	if endpointSecret == "" {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

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

		if _, err := updateSubscriptionStatus(subID); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
	case "customer.subscription.updated", "customer.subscription.deleted":
		subID, _ := obj["id"].(string)

		// the status in the payload is stale when events arrive out of order, so ask Stripe for the current one
		status, err := updateSubscriptionStatus(subID)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if status != "active" && status != "trialing" {
			closeStreamsOfSubscription(r.Context(), subID)
		}
	}

	w.WriteHeader(http.StatusOK)
}

func closeStreamsOfSubscription(ctx context.Context, subID string) {
	if !constants.Metadata.Registration.SubscriptionRequired {
		return
	}

	var uuid string
	if err := database.QueryRow(ctx,
		"SELECT uuid FROM users WHERE stripe_subscription_id = ?", subID,
	).Scan(&uuid); err != nil {
		if err != sql.ErrNoRows {
			utils.LogError("closeStreamsOfSubscription", "QueryRow", err)
		}
		return
	}

	stream.CloseUser(uuid, "")
}
