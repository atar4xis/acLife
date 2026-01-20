package types

type Price struct {
	ID            string `json:"id"`            // stripe price ID
	Amount        int    `json:"amount"`        // minor units
	Currency      string `json:"currency"`      // three-letter ISO code
	BillingPeriod string `json:"billingPeriod"` // "week", "month", "year"
}

type EmailSettings struct {
	VerificationRequired bool     `json:"verificationRequired"`
	DomainBlacklist      []string `json:"domainBlacklist"`
}

type Registration struct {
	Enabled              bool           `json:"enabled"`
	SubscriptionRequired bool           `json:"subscriptionRequired"`
	Email                *EmailSettings `json:"email,omitempty"`
	RetentionPeriod      int            `json:"retentionPeriod,omitempty"` // in days
}

type Policies struct {
	Privacy string `json:"privacy,omitempty"`
	Terms   string `json:"terms,omitempty"`
}

type ServerMetadata struct {
	URL            string       `json:"url"`
	Policies       *Policies    `json:"policies,omitempty"`
	Registration   Registration `json:"registration"`
	VapidPublicKey string       `json:"vapidPublicKey"`
}
