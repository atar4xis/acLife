package types

// PushSubscription represents a push subscription returned from the database.
type PushSubscription struct {
	ID       int    `db:"id"`
	Owner    string `db:"owner"`
	Endpoint string `db:"endpoint"`
	P256DH   string `db:"p256dh"`
	Auth     string `db:"auth"`
}

type PushEvent struct {
	Type string `json:"type"`

	// For type == "notification"
	Title string `json:"title,omitempty"`
	Body  string `json:"body,omitempty"`

	// For type == "sync"
	OriginClientID string `json:"originClientId,omitempty"`
}
