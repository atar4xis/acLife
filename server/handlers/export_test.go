package handlers

import "github.com/stripe/stripe-go/v84"

var BucketHash = bucketHash

func SetSubscriptionUpdater(f func(string, ...string) (string, error)) { updateSubscriptionStatus = f }

func SetPriceGetter(f func(string, *stripe.PriceParams) (*stripe.Price, error)) { getPrice = f }

func SetCheckoutCreator(f func(*stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error)) {
	createCheckout = f
}

func SetAfterSubscribe(f func()) { afterSubscribe = f }
