package types

import "time"

// CalendarEvent represents the calendar event data returned from the database.
type CalendarEvent struct {
	ID        string    `db:"id"` // uuid
	Data      []byte    `db:"data"`
	UpdatedAt time.Time `db:"updated_at"`
}

// EventSyncRequest is the structure of an event sync request.
type EventSyncRequest struct {
	Records []CachedRecord    `json:"records"`
	Buckets []string          `json:"buckets"`
	Hashes  map[string]string `json:"hashes"` // bucket id -> client's hash of cached events in that bucket
}

// EventHashResponse is the response to an event sync request that carries hashes.
type EventHashResponse struct {
	Mismatched []string `json:"mismatched"`
}

// EventSyncResponse is the structure of the response to an event sync request.
type EventSyncResponse = SyncDiff[EncryptedEvent]

// EncryptedEvent is an encrypted calendar event plus the buckets it belongs to.
type EncryptedEvent struct {
	EncryptedRecord
	Buckets []string `json:"buckets,omitempty"`
}
