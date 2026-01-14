package types

import "time"

// CalendarEvent represents the calendar event data returned from the database.
type CalendarEvent struct {
	ID        string    `db:"id"` // uuid
	Data      []byte    `db:"data"`
	UpdatedAt time.Time `db:"updated_at"`
}

// CachedEvent represents a cached event received from the client.
type CachedEvent struct {
	ID        string `json:"id"`
	Timestamp int64  `json:"ts"`
}

// EventSyncResponse is the structure of the response to an event sync request.
type EventSyncResponse struct {
	Updated []EncryptedEvent `json:"updated"`
	Deleted []string         `json:"deleted"`
	Added   []EncryptedEvent `json:"added"`
}

type EncryptedEvent struct {
	ID        string `json:"id"`
	Data      string `json:"data"`
	UpdatedAt int64  `json:"updatedAt"`
}
