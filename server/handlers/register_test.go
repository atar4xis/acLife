package handlers_test

import (
	"net/http"
	"testing"

	"acLife/internal/testutil"
	"acLife/types"
)

func TestRegisterCreatesAnAccount(t *testing.T) {
	testutil.RequireDB(t)
	email := testutil.RandomHex(6) + "@example.com"

	if status := testutil.Register(t, testutil.NewClient(t), email); status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
	if count(t, "SELECT COUNT(*) FROM users WHERE email = ?", email) != 1 {
		t.Fatal("account missing")
	}
}

func TestRegisterRefusesAnExistingEmail(t *testing.T) {
	testutil.RequireDB(t)
	user := testutil.NewUser(t, testutil.Unverified())

	if status := testutil.Register(t, testutil.NewClient(t), user.Email); status != http.StatusConflict {
		t.Fatalf("got %d", status)
	}
	if count(t, "SELECT COUNT(*) FROM users WHERE uuid = ?", user.UUID) != 1 {
		t.Fatal("account was deleted")
	}
}

func TestRegisterIsClosedWhenVerificationIsRequired(t *testing.T) {
	testutil.RequireDB(t)
	withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = true })
	email := testutil.RandomHex(6) + "@example.com"

	if status := testutil.Register(t, testutil.NewClient(t), email); status != http.StatusBadRequest {
		t.Fatalf("got %d", status)
	}
	if count(t, "SELECT COUNT(*) FROM users WHERE email = ?", email) != 0 {
		t.Fatal("account created")
	}
}
