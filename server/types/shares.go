package types

type UserKeys struct {
	PublicKey      []byte `json:"publicKey"`
	WrappedPrivate []byte `json:"wrappedPrivate,omitempty"`
}

type KeyLookupRequest struct {
	Email string `json:"email"`
}

type KeyLookupResponse struct {
	UUID      string `json:"uuid"`
	PublicKey []byte `json:"publicKey"`
}

type ShareMember struct {
	User       string `json:"user"`
	Email      string `json:"email"`
	PublicKey  []byte `json:"publicKey"`
	Permission string `json:"permission"`
	Status     string `json:"status"`
}

type OwnedShare struct {
	ID         string        `json:"id"`
	Kind       string        `json:"kind"`
	Scope      string        `json:"scope"`
	OwnerKey   []byte        `json:"ownerKey"`
	KeyVersion int           `json:"keyVersion"`
	Members    []ShareMember `json:"members"`
}

type ReceivedShare struct {
	ID             string `json:"id"`
	Owner          string `json:"owner"`
	OwnerEmail     string `json:"ownerEmail"`
	OwnerPublicKey []byte `json:"ownerPublicKey"`
	Kind           string `json:"kind"`
	Scope          string `json:"scope"`
	Permission     string `json:"permission"`
	Status         string `json:"status"`
	WrappedKey     []byte `json:"wrappedKey"`
	KeyVersion     int    `json:"keyVersion"`
}

type ShareList struct {
	Owned    []OwnedShare    `json:"owned"`
	Received []ReceivedShare `json:"received"`
}

type NewMember struct {
	User       string `json:"user"`
	Permission string `json:"permission"`
	WrappedKey []byte `json:"wrappedKey"`
}

type CreateSpaceRequest struct {
	ID       string      `json:"id"`
	Kind     string      `json:"kind"`
	Scope    string      `json:"scope"`
	OwnerKey []byte      `json:"ownerKey"`
	Members  []NewMember `json:"members"`
}

type SpaceRequest struct {
	Space string `json:"space"`
}

type AddMemberRequest struct {
	Space string `json:"space"`
	NewMember
}

type PermissionRequest struct {
	Space      string `json:"space"`
	User       string `json:"user"`
	Permission string `json:"permission"`
}

type SpaceCreated struct {
	ID string `json:"id"`
}
