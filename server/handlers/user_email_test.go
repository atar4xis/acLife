package handlers_test

import (
	"bytes"
	"net/http"
	"testing"
	"time"

	"acLife/database"
	"acLife/internal/testutil"
	"acLife/types"

	"mz.attahri.com/code/srp/v3"
)

func tripletBytes(t *testing.T, username string, salt, verifier byte, saltLen, verifierLen int) []byte {
	t.Helper()

	tr, err := srp.NewTriplet(username, bytes.Repeat([]byte{salt}, saltLen), bytes.Repeat([]byte{verifier}, verifierLen))
	if err != nil {
		t.Fatal(err)
	}
	return tr
}

func insertVerificationToken(t *testing.T, owner, email string) string {
	t.Helper()

	token := testutil.RandomHex(32)
	now := time.Now()
	if _, err := database.DB.Exec(
		`INSERT INTO email_verification_tokens (owner, email, token, expires_at, last_sent_at, send_window_start)
		VALUES (?, ?, ?, ?, ?, ?)`,
		owner, email, token, now.Add(time.Hour), now, now,
	); err != nil {
		t.Fatal(err)
	}
	return token
}

func confirmEmail(c *testutil.Client, token string) int {
	status, _ := testutil.Call[any](c, "POST", "/auth/verify-email", map[string]string{"token": token})
	return status
}

func changeEmail(t *testing.T, c *testutil.Client, user testutil.User, newEmail string) (int, types.Reply[types.EmailUnverifiedData]) {
	t.Helper()

	body := testutil.Reauth(t, c, user, testutil.Password)
	body["triplet"] = tripletBytes(t, newEmail, 3, 4, 16, 32)
	return testutil.Call[types.EmailUnverifiedData](c, "POST", "/user/email", body)
}

func isVerified(t *testing.T, uuid string) bool {
	t.Helper()

	return count(t, "SELECT COUNT(*) FROM users WHERE uuid = ? AND email_verified = 1", uuid) == 1
}

func TestConfirmEmailVerifiesTheAccount(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t, testutil.Unverified())
	token := insertVerificationToken(t, user.UUID, user.Email)

	if status := confirmEmail(testutil.NewClient(t), token); status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
	if !isVerified(t, user.UUID) {
		t.Fatal("account not verified")
	}
}

func TestConfirmEmailRejectsTokenIssuedForAnotherEmail(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t, testutil.Unverified())
	token := insertVerificationToken(t, user.UUID, "someone-else@example.org")

	if status := confirmEmail(testutil.NewClient(t), token); status != http.StatusBadRequest {
		t.Fatalf("got %d", status)
	}
	if isVerified(t, user.UUID) {
		t.Fatal("account verified by a token for another email")
	}
}

func TestUpdateEmailInvalidatesTheOldVerificationToken(t *testing.T) {
	testutil.RequireDB(t)
	withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = true })
	user := testutil.NewUser(t)
	oldToken := insertVerificationToken(t, user.UUID, user.Email)
	const newEmail = "new-address@example.org"

	status, reply := changeEmail(t, testutil.NewClient(t).As(user), user, newEmail)
	if status != http.StatusForbidden || reply.Code != "email_verification_required" {
		t.Fatalf("got %d %q", status, reply.Code)
	}

	if status := confirmEmail(testutil.NewClient(t), oldToken); status != http.StatusBadRequest {
		t.Fatalf("old token: got %d", status)
	}
	if isVerified(t, user.UUID) {
		t.Fatal("old token verified the new email")
	}

	if n := count(t, "SELECT COUNT(*) FROM email_queue WHERE recipient = ?", newEmail); n != 1 {
		t.Fatalf("%d mails queued for the new email", n)
	}
	var newToken string
	if err := database.DB.QueryRow("SELECT token FROM email_verification_tokens WHERE owner = ? AND email = ?", user.UUID, newEmail).Scan(&newToken); err != nil {
		t.Fatalf("no token bound to the new email: %v", err)
	}
	if status := confirmEmail(testutil.NewClient(t), newToken); status != http.StatusOK {
		t.Fatalf("new token: got %d", status)
	}
	if !isVerified(t, user.UUID) {
		t.Fatal("new token did not verify")
	}
}

func TestUpdateEmailWithoutVerificationDropsTheOldToken(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t)
	insertVerificationToken(t, user.UUID, user.Email)

	if status, _ := changeEmail(t, testutil.NewClient(t).As(user), user, "new-address@example.org"); status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
	if n := count(t, "SELECT COUNT(*) FROM email_verification_tokens WHERE owner = ?", user.UUID); n != 0 {
		t.Fatalf("%d tokens remain", n)
	}
}

func TestUpdateEmailToATakenAddressChangesNothing(t *testing.T) {
	testutil.RequireDB(t)
	withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = true })
	user, other := testutil.NewUser(t), testutil.NewUser(t)
	token := insertVerificationToken(t, user.UUID, user.Email)

	if status, _ := changeEmail(t, testutil.NewClient(t).As(user), user, other.Email); status != http.StatusConflict {
		t.Fatalf("got %d", status)
	}
	if n := count(t, "SELECT COUNT(*) FROM email_verification_tokens WHERE owner = ? AND token = ?", user.UUID, token); n != 1 {
		t.Fatal("token removed by a failed change")
	}
	if !isVerified(t, user.UUID) {
		t.Fatal("verification lost by a failed change")
	}
}
