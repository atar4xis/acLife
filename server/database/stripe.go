package database

import (
	"context"
	"os"

	"acLife/utils"

	"github.com/stripe/stripe-go/v84"
	"github.com/stripe/stripe-go/v84/subscription"
)

// UpdateSubscriptionStatus fetches a subscription from Stripe and updates subscription_status in the DB.
func UpdateSubscriptionStatus(subID string, status ...string) error {
	if subID == "" {
		return nil
	}

	subStatus := ""
	if len(status) > 0 && status[0] != "" {
		// Use provided status
		subStatus = status[0]
	} else {
		// Fetch subscription from Stripe
		stripe.Key = os.Getenv("STRIPE_API_KEY")
		s, err := subscription.Get(subID, nil)
		if err != nil {
			utils.LogError("UpdateSubscriptionStatus", "sub.Get", err)
			return err
		}
		subStatus = string(s.Status)
	}

	// Update database
	ctx := context.Background()
	_, err := Exec(ctx, `
        UPDATE users
        SET subscription_status=?
        WHERE stripe_subscription_id=?`,
		subStatus, subID,
	)
	if err != nil {
		utils.LogError("UpdateSubscriptionStatus", "database.Exec", err)
		return err
	}

	return nil
}
