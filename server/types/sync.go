package types

// Recorded is implemented by every encrypted record shape that can travel in a save request.
type Recorded interface {
	Base() EncryptedRecord
}

// EncryptedRecord is one opaque encrypted row as it travels between client and server.
type EncryptedRecord struct {
	ID        string `json:"id"`
	Data      string `json:"data"`
	UpdatedAt int64  `json:"updatedAt"`
}

func (r EncryptedRecord) Base() EncryptedRecord { return r }

// CachedRecord is a record the client already holds, identified by id and timestamp.
type CachedRecord struct {
	ID        string `json:"id"`
	Timestamp int64  `json:"ts"`
}

// RecordChange is one entry of a save request body.
type RecordChange[T Recorded] struct {
	Type   string `json:"type"`
	ID     string `json:"id,omitempty"`
	Record T      `json:"record"`
}

// SyncDiff is what the client must apply to catch up with the server.
type SyncDiff[T any] struct {
	Updated []T      `json:"updated"`
	Deleted []string `json:"deleted"`
	Added   []T      `json:"added"`
}
