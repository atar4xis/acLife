package handlers_test

import (
	"net/http"
	"testing"

	"acLife/handlers"
	"acLife/internal/testutil"
	"acLife/types"

	"github.com/stripe/stripe-go/v84"
	"github.com/stripe/stripe-go/v84/checkout/session"
	"github.com/stripe/stripe-go/v84/price"
)

func TestCheckoutOnlyAcceptsPricesOfTheConfiguredProduct(t *testing.T) {
	testutil.RequireDB(t)
	t.Setenv("STRIPE_PRODUCT_ID", "prod_ours")

	var gotParams *stripe.CheckoutSessionParams
	handlers.SetCheckoutCreator(func(p *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
		gotParams = p
		return &stripe.CheckoutSession{URL: "https://checkout.test/s"}, nil
	})
	t.Cleanup(func() { handlers.SetCheckoutCreator(session.New) })

	setPrice := func(p *stripe.Price, err error) {
		handlers.SetPriceGetter(func(string, *stripe.PriceParams) (*stripe.Price, error) { return p, err })
		t.Cleanup(func() { handlers.SetPriceGetter(price.Get) })
	}
	checkout := func() (int, string) {
		gotParams = nil
		client := testutil.NewClient(t).As(testutil.NewUser(t))
		status, reply := testutil.Call[string](client, "POST", "/stripe/checkout", map[string]string{"priceId": "price_1"})
		return status, reply.Data
	}

	cases := map[string]struct {
		price  *stripe.Price
		err    error
		status int
	}{
		"price of the product":   {price: &stripe.Price{Active: true, Product: &stripe.Product{ID: "prod_ours"}}, status: http.StatusOK},
		"price of other product": {price: &stripe.Price{Active: true, Product: &stripe.Product{ID: "prod_other"}}, status: http.StatusBadRequest},
		"inactive price":         {price: &stripe.Price{Active: false, Product: &stripe.Product{ID: "prod_ours"}}, status: http.StatusBadRequest},
		"price without product":  {price: &stripe.Price{Active: true}, status: http.StatusBadRequest},
		"unknown price":          {err: &stripe.Error{HTTPStatusCode: http.StatusNotFound}, status: http.StatusBadRequest},
		"stripe failure":         {err: &stripe.Error{HTTPStatusCode: http.StatusInternalServerError}, status: http.StatusInternalServerError},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			setPrice(tc.price, tc.err)

			status, url := checkout()
			if status != tc.status {
				t.Fatalf("got %d", status)
			}
			if created := gotParams != nil; created != (tc.status == http.StatusOK) {
				t.Fatalf("checkout session created: %v", created)
			}
			if tc.status == http.StatusOK && url != "https://checkout.test/s" {
				t.Fatalf("url %q", url)
			}
		})
	}
}

func TestCheckoutIsRefusedWithAnActiveSubscription(t *testing.T) {
	testutil.RequireDB(t)
	t.Setenv("STRIPE_PRODUCT_ID", "prod_ours")
	handlers.SetPriceGetter(func(string, *stripe.PriceParams) (*stripe.Price, error) {
		return &stripe.Price{Active: true, Product: &stripe.Product{ID: "prod_ours"}}, nil
	})
	created := false
	handlers.SetCheckoutCreator(func(*stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
		created = true
		return &stripe.CheckoutSession{URL: "https://checkout.test/s"}, nil
	})
	t.Cleanup(func() {
		handlers.SetPriceGetter(price.Get)
		handlers.SetCheckoutCreator(session.New)
	})

	for status, want := range map[string]int{"active": http.StatusConflict, "trialing": http.StatusConflict, "canceled": http.StatusOK, "past_due": http.StatusOK} {
		t.Run(status, func(t *testing.T) {
			created = false
			client := testutil.NewClient(t).As(testutil.NewUser(t, testutil.Subscribed(status)))

			got, reply := testutil.Call[string](client, "POST", "/stripe/checkout", map[string]string{"priceId": "price_1"})
			if got != want || (want == http.StatusConflict && reply.Code != "already_subscribed") {
				t.Fatalf("got %d %q", got, reply.Code)
			}
			if created != (want == http.StatusOK) {
				t.Fatalf("checkout session created: %v", created)
			}
		})
	}
}

func TestStripeCallsAreLimitedPerUser(t *testing.T) {
	testutil.RequireDB(t)
	t.Setenv("STRIPE_PRODUCT_ID", "prod_ours")
	handlers.SetPriceGetter(func(string, *stripe.PriceParams) (*stripe.Price, error) {
		return &stripe.Price{Active: true, Product: &stripe.Product{ID: "prod_ours"}}, nil
	})
	handlers.SetCheckoutCreator(func(*stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
		return &stripe.CheckoutSession{URL: "https://checkout.test/s"}, nil
	})
	t.Cleanup(func() {
		handlers.SetPriceGetter(price.Get)
		handlers.SetCheckoutCreator(session.New)
	})

	c := testutil.NewClient(t)
	user, other := c.As(testutil.NewUser(t)), c.As(testutil.NewUser(t))
	for i := range 5 {
		if status, _ := testutil.Call[string](user, "POST", "/stripe/checkout", map[string]string{"priceId": "price_1"}); status != http.StatusOK {
			t.Fatalf("request %d: %d", i, status)
		}
	}

	if status, _ := testutil.Call[string](user, "POST", "/stripe/checkout", map[string]string{"priceId": "price_1"}); status != http.StatusTooManyRequests {
		t.Fatalf("got %d", status)
	}
	if status, _ := testutil.Call[string](other, "POST", "/stripe/checkout", map[string]string{"priceId": "price_1"}); status != http.StatusOK {
		t.Fatalf("another user was limited: %d", status)
	}
}

func TestPricingIsCached(t *testing.T) {
	testutil.RequireDB(t)
	handlers.ResetPricingCache()
	calls := 0
	handlers.SetPriceLister(func() ([]types.Price, error) {
		calls++
		return []types.Price{{ID: "price_1", Amount: 500}}, nil
	})
	t.Cleanup(func() {
		handlers.SetPriceLister(handlers.FetchPrices)
		handlers.ResetPricingCache()
	})

	c := testutil.NewClient(t).As(testutil.NewUser(t))
	for range 3 {
		status, reply := testutil.Call[[]types.Price](c, "GET", "/stripe/pricing", nil)
		if status != http.StatusOK || len(reply.Data) != 1 {
			t.Fatalf("got %d %+v", status, reply)
		}
	}
	if calls != 1 {
		t.Fatalf("stripe was asked %d times", calls)
	}
}
