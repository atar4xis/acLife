package utils

import (
	"golang.org/x/crypto/argon2"
)

// KDFArgon2 derives an Argon2id key from a username, password, and salt.
func KDFArgon2(username, password string, salt []byte) ([]byte, error) {
	p := []byte(username + ":" + password)
	key := argon2.IDKey(p, salt, 3, 65536, 1, 32)
	return key, nil
}
