package handlers

import (
	"acLife/types"

	"github.com/stripe/stripe-go/v84"
)

var (
	BucketHash                      = bucketHash
	FetchPrices                     = fetchPrices
	DeleteStalePendingRegistrations = deleteStalePendingRegistrations
)

func SetSubscriptionUpdater(f func(string, ...string) (string, error)) { updateSubscriptionStatus = f }

func SetPriceGetter(f func(string, *stripe.PriceParams) (*stripe.Price, error)) { getPrice = f }

func SetCheckoutCreator(f func(*stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error)) {
	createCheckout = f
}

func SetAfterSubscribe(f func()) { afterSubscribe = f }

func SetPriceLister(f func() ([]types.Price, error)) { listPrices = f }

func ResetPricingCache() { pricingCache.prices = nil }
