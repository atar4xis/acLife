package handlers_test

import (
	"bytes"
	"maps"
	"net/http"
	"testing"

	"acLife/constants"
	"acLife/database"
	"acLife/internal/testutil"
	"acLife/types"
)

var testEnvelope = types.KeyEnvelope{Type: "master", Version: 1, Salt: []byte{1}, Data: []byte{1}, KDFParams: "{}"}

func verifierOf(t *testing.T, uuid string) []byte {
	t.Helper()

	var v []byte
	if err := database.DB.QueryRow("SELECT verifier FROM users WHERE uuid = ?", uuid).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

// passwordEndpoints are the calls that need the current password, with a body that is valid apart from the proof.
func passwordEndpoints(t *testing.T, u testutil.User) map[string]map[string]any {
	t.Helper()

	return map[string]map[string]any{
		"/user/password": {
			"triplet":   tripletBytes(t, u.Email, 3, 4, 16, 32),
			"envelopes": []types.KeyEnvelope{testEnvelope},
		},
		"/user/email": {
			"triplet": tripletBytes(t, "changed-"+u.Email, 3, 4, 16, 32),
		},
	}
}

func withProof(body, proof map[string]any) map[string]any {
	out := map[string]any{}
	maps.Copy(out, body)
	maps.Copy(out, proof)
	return out
}

func TestPasswordEndpointsRequireTheCurrentPassword(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	before := verifierOf(t, user.UUID)

	for path, body := range passwordEndpoints(t, user) {
		t.Run(path, func(t *testing.T) {
			c := testutil.NewClient(t).As(user)

			status, reply := testutil.Call[any](c, "POST", path, body)
			if status != http.StatusBadRequest || reply.Code != "session_expired" {
				t.Fatalf("no proof: %d %q", status, reply.Code)
			}

			proof := testutil.Reauth(t, c, user, "wrong password")
			status, reply = testutil.Call[any](c, "POST", path, withProof(body, proof))
			if status != http.StatusBadRequest || reply.Code != "current_password_incorrect" {
				t.Fatalf("wrong password: %d %q", status, reply.Code)
			}

			if !bytes.Equal(verifierOf(t, user.UUID), before) {
				t.Fatal("credentials changed without the password")
			}
			if n := count(t, "SELECT COUNT(*) FROM key_envelopes WHERE owner = ?", user.UUID); n != 0 {
				t.Fatalf("%d envelopes stored without the password", n)
			}
		})
	}
}

func TestPasswordEndpointsAcceptTheCurrentPassword(t *testing.T) {
	testutil.RequireDB(t)

	for path := range passwordEndpoints(t, testutil.User{Email: "x@example.com"}) {
		t.Run(path, func(t *testing.T) {
			if path == "/user/email" {
				t.Skip("covered by the email tests")
			}

			user := testutil.NewUser(t)
			c := testutil.NewClient(t).As(user)
			proof := testutil.Reauth(t, c, user, testutil.Password)
			if status, reply := testutil.Call[any](c, "POST", path, withProof(passwordEndpoints(t, user)[path], proof)); status != http.StatusOK {
				t.Fatalf("got %d %+v", status, reply)
			}
		})
	}
}

func TestPasswordProofWorksOnce(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)
	proof := testutil.Reauth(t, c, user, testutil.Password)
	body := withProof(passwordEndpoints(t, user)["/user/password"], proof)

	if status, _ := testutil.Call[any](c, "POST", "/user/password", body); status != http.StatusOK {
		t.Fatalf("first use: %d", status)
	}
	if status, reply := testutil.Call[any](c, "POST", "/user/password", body); status != http.StatusBadRequest || reply.Code != "session_expired" {
		t.Fatalf("replay: %d %q", status, reply.Code)
	}
}

func TestPasswordProofIsBoundToItsUser(t *testing.T) {
	testutil.RequireDB(t)
	user, other := testutil.NewUser(t), testutil.NewUser(t)
	srv := testutil.NewClient(t)
	proof := testutil.Reauth(t, srv.As(other), other, testutil.Password)

	status, reply := testutil.Call[any](srv.As(user), "POST", "/user/password", withProof(passwordEndpoints(t, user)["/user/password"], proof))
	if status != http.StatusBadRequest || reply.Code != "session_expired" {
		t.Fatalf("got %d %q", status, reply.Code)
	}
	if n := count(t, "SELECT COUNT(*) FROM key_envelopes"); n != 0 {
		t.Fatalf("%d envelopes stored", n)
	}
}

func TestLoginAndReauthSessionsAreNotInterchangeable(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t).As(user)

	proof := testutil.Reauth(t, c, user, testutil.Password)
	status, _ := testutil.Call[any](c, "POST", "/auth/login/verify", withProof(map[string]any{"email": user.Email}, proof))
	if status != http.StatusUnauthorized {
		t.Fatalf("reauth session logged in: %d", status)
	}

	status, proof = testutil.Proof(t, c, "/auth/login/start", map[string]any{"email": user.Email}, user.Email, testutil.Password)
	if status != http.StatusOK {
		t.Fatalf("login start: %d", status)
	}
	status, reply := testutil.Call[any](c, "POST", "/user/password", withProof(passwordEndpoints(t, user)["/user/password"], proof))
	if status != http.StatusBadRequest || reply.Code != "session_expired" {
		t.Fatalf("login session proved a password change: %d %q", status, reply.Code)
	}
}

func login(t *testing.T, c *testutil.Client, u testutil.User, password string) (int, types.Reply[any]) {
	t.Helper()

	status, proof := testutil.Proof(t, c, "/auth/login/start", map[string]any{"email": u.Email}, u.Email, password)
	if status != http.StatusOK {
		return status, types.Reply[any]{}
	}
	return testutil.Call[any](c, "POST", "/auth/login/verify", withProof(map[string]any{"email": u.Email}, proof))
}

func TestLoginWithThePassword(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t)

	if status, _ := login(t, c, user, "wrong password"); status != http.StatusUnauthorized {
		t.Fatalf("wrong password: %d", status)
	}
	if status, reply := login(t, c, user, testutil.Password); status != http.StatusOK {
		t.Fatalf("got %d %+v", status, reply)
	}
}

func TestAccountLocksAfterRepeatedFailedProofs(t *testing.T) {
	testutil.RequireDB(t)
	user, bystander := testutil.NewUser(t), testutil.NewUser(t)
	c := testutil.NewClient(t)

	for range constants.MaxLoginFailures {
		if status, _ := login(t, c, user, "wrong password"); status != http.StatusUnauthorized {
			t.Fatalf("got %d", status)
		}
	}

	if status, _ := login(t, c, user, testutil.Password); status != http.StatusTooManyRequests {
		t.Fatalf("correct password while locked: %d", status)
	}
	if status, _ := login(t, c, bystander, testutil.Password); status != http.StatusOK {
		t.Fatalf("another account was locked: %d", status)
	}

	asUser := testutil.NewClient(t).As(user)
	if status, reply := testutil.Call[any](asUser, "POST", "/user/reauth/start", map[string]any{"A": []byte{1}}); status != http.StatusTooManyRequests || reply.Code != "too_many_attempts_minutes" {
		t.Fatalf("reauth while locked: %d %q", status, reply.Code)
	}
}

func TestSuccessfulLoginClearsFailedProofs(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t)

	for range constants.MaxLoginFailures - 1 {
		login(t, c, user, "wrong password")
	}
	if status, _ := login(t, c, user, testutil.Password); status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
	c = testutil.NewClient(t) // fresh rate limit
	for range constants.MaxLoginFailures - 1 {
		login(t, c, user, "wrong password")
	}
	if status, _ := login(t, c, user, testutil.Password); status != http.StatusOK {
		t.Fatalf("failures were not cleared: %d", status)
	}
}

func TestStartedSessionsCannotBeVerifiedWhileLocked(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	c := testutil.NewClient(t)

	proofs := make([]map[string]any, constants.MaxLoginFailures+1)
	for i := range proofs {
		status, proof := testutil.Proof(t, c, "/auth/login/start", map[string]any{"email": user.Email}, user.Email, testutil.Password)
		if status != http.StatusOK {
			t.Fatalf("start %d: %d", i, status)
		}
		proofs[i] = proof
	}

	for i := range constants.MaxLoginFailures {
		proofs[i]["M1"] = []byte{1}
		testutil.Call[any](c, "POST", "/auth/login/verify", withProof(map[string]any{"email": user.Email}, proofs[i]))
	}

	status, reply := testutil.Call[any](c, "POST", "/auth/login/verify", withProof(map[string]any{"email": user.Email}, proofs[constants.MaxLoginFailures]))
	if status != http.StatusTooManyRequests || reply.Code != "too_many_attempts_minutes" {
		t.Fatalf("got %d %q", status, reply.Code)
	}
}

func TestConfirmEmailDeletesTheToken(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t, testutil.Unverified())
	token := insertVerificationToken(t, user.UUID, user.Email)

	if status := confirmEmail(testutil.NewClient(t), token); status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
	if n := count(t, "SELECT COUNT(*) FROM email_verification_tokens WHERE owner = ?", user.UUID); n != 0 {
		t.Fatalf("%d tokens remain", n)
	}
	if status := confirmEmail(testutil.NewClient(t), token); status != http.StatusBadRequest {
		t.Fatalf("replay: %d", status)
	}
}

func TestRemovedRoutesAreGone(t *testing.T) {
	testutil.RequireDB(t)
	c := testutil.NewClient(t).As(testutil.NewUser(t))

	for _, path := range []string{"/user/challenge", "/user/envelopes", "/calendar/events/migrate-envelope"} {
		if resp, _ := c.Do("POST", path, map[string]any{}); resp.StatusCode != http.StatusNotFound {
			t.Fatalf("%s: got %d", path, resp.StatusCode)
		}
	}
}
