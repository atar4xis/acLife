package testutil

import (
	"bytes"
	"crypto"
	"crypto/sha256"
	"maps"
	"testing"

	"mz.attahri.com/code/srp/v3"
)

// Password is the password every user from NewUser has.
const Password = "correct horse battery staple"

// the server never runs the kdf, so tests use a cheap one for the verifier and the client
var srpParams = &srp.Params{
	Name:  "test",
	Group: srp.RFC5054Group4096,
	Hash:  crypto.SHA256,
	KDF: func(username, password string, salt []byte) ([]byte, error) {
		sum := sha256.Sum256(append(salt, username+":"+password...))
		return sum[:], nil
	},
}

var srpSalt = bytes.Repeat([]byte{1}, 16)

func verifierFor(t *testing.T, email string) []byte {
	t.Helper()

	triplet, err := srp.ComputeVerifier(srpParams, email, Password, srpSalt)
	if err != nil {
		t.Fatalf("compute verifier: %v", err)
	}
	return triplet.Verifier()
}

// Proof runs the client half of SRP against the start endpoint at path, as someone who knows password.
// startFields are sent next to A. It returns the start status and, when that succeeded, the M1 and session_id fields of the proof step.
func Proof(t *testing.T, c *Client, path string, startFields map[string]any, email, password string) (int, map[string]any) {
	t.Helper()

	client, err := srp.NewClient(srpParams, email, password, srpSalt)
	if err != nil {
		t.Fatalf("new client: %v", err)
	}

	body := map[string]any{"A": client.A()}
	maps.Copy(body, startFields)

	status, reply := Call[struct {
		B         []byte `json:"B"`
		SessionID string `json:"session_id"`
	}](c, "POST", path, body)
	if status != 200 {
		return status, nil
	}

	if err := client.SetB(reply.Data.B); err != nil {
		t.Fatalf("set B: %v", err)
	}
	m1, err := client.ComputeM1()
	if err != nil {
		t.Fatalf("compute M1: %v", err)
	}
	return status, map[string]any{"M1": m1, "session_id": reply.Data.SessionID}
}

// Reauth returns the fields that prove password to an endpoint that needs it.
func Reauth(t *testing.T, c *Client, u User, password string) map[string]any {
	t.Helper()

	status, proof := Proof(t, c, "/user/reauth/start", nil, u.Email, password)
	if status != 200 {
		t.Fatalf("reauth start: %d", status)
	}
	return proof
}
