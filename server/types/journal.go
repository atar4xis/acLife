package types

type JournalSyncPart struct {
	Space   string         `json:"space,omitempty"`
	Hash    string         `json:"hash"`    // hash of every cached item, set for the first step only
	Buckets []string       `json:"buckets"` // two-char id prefixes to diff, set for the second step only
	Records []CachedRecord `json:"records"` // the client's cached items in those buckets
}

type JournalSyncRequest struct {
	Parts []JournalSyncPart `json:"parts"`
}

// JournalHashResponse is the response to a journal sync request that carries a hash.
type JournalHashResponse struct {
	Match bool   `json:"match"`
	Table string `json:"table,omitempty"` // per-bucket hash prefixes, 00 to ff concatenated, only on mismatch
}

// JournalSyncResponse is the structure of the response to a journal sync request with buckets.
type JournalSyncResponse struct {
	SyncDiff[EncryptedRecord]
	Remaining []string `json:"remaining"` // buckets the client must ask for again, the page size cap was reached
}
