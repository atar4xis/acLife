package testutil

import (
	"bytes"
	"crypto"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"maps"
	"math/bits"
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

func SolvePow(t *testing.T, c *Client, email string) (token, nonce string) {
	t.Helper()

	status, challenge := Call[struct {
		Token string `json:"token"`
	}](c, "POST", "/auth/register/challenge", map[string]any{"email": email})
	if status != 200 {
		t.Fatalf("challenge: %d", status)
	}

	return challenge.Data.Token, PowNonce(t, challenge.Data.Token, func(zeros, difficulty int) bool { return zeros >= difficulty })
}

func PowNonce(t *testing.T, token string, accept func(zeros, difficulty int) bool) string {
	t.Helper()

	payload, _, _ := bytes.Cut([]byte(token), []byte("."))
	raw, err := base64.RawURLEncoding.DecodeString(string(payload))
	if err != nil {
		t.Fatalf("decode challenge: %v", err)
	}
	var data struct {
		Seed, Email string
		Difficulty  int
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatalf("unmarshal challenge: %v", err)
	}

	for n := 0; ; n++ {
		sum := sha256.Sum256(fmt.Appendf(nil, "%s|%s|%d", data.Seed, data.Email, n))
		zeros := 0
		for _, b := range sum {
			if b != 0 {
				zeros += bits.LeadingZeros8(b)
				break
			}
			zeros += 8
		}
		if accept(zeros, data.Difficulty) {
			return fmt.Sprint(n)
		}
	}
}

func Credentials(t *testing.T, email string) (triplet []byte, envelopes []map[string]any) {
	t.Helper()

	tr, err := srp.ComputeVerifier(srpParams, email, Password, srpSalt)
	if err != nil {
		t.Fatalf("compute verifier: %v", err)
	}

	return []byte(tr), []map[string]any{
		{"type": "master", "version": 1, "salt": []byte{1}, "data": []byte{1}, "kdfParams": "{}"},
	}
}

// Register runs the whole registration of email with Password as a client would, proof of work included, and returns the status of the final request.
func Register(t *testing.T, c *Client, email string) int {
	t.Helper()

	token, nonce := SolvePow(t, c, email)
	triplet, envelopes := Credentials(t, email)

	status, _ := Call[any](c, "POST", "/auth/register", map[string]any{
		"triplet":   triplet,
		"envelopes": envelopes,
		"powToken":  token,
		"powNonce":  nonce,
	})
	return status
}
