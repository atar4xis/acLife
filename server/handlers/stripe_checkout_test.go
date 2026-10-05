package handlers_test

import (
	"net/http"
	"testing"

	"acLife/handlers"
	"acLife/internal/testutil"

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
