package handlers_test

import (
	"net/http"
	"testing"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/internal/testutil"
	"acLife/types"
)

func ageToken(t *testing.T, owner string, age time.Duration) {
	t.Helper()

	if _, err := database.DB.Exec("UPDATE email_verification_tokens SET created_at = ? WHERE owner = ?", time.Now().Add(-age), owner); err != nil {
		t.Fatal(err)
	}
}

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

func TestRegisterRefusesAVerifiedEmail(t *testing.T) {
	testutil.RequireDB(t)
	withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = true })
	user := testutil.NewUser(t)

	if status := testutil.Register(t, testutil.NewClient(t), user.Email); status != http.StatusConflict {
		t.Fatalf("got %d", status)
	}
}

func TestRegisterReplacesAStaleUnverifiedAccount(t *testing.T) {
	testutil.RequireDB(t)
	withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = true })
	squatter := testutil.NewUser(t, testutil.Unverified())
	insertVerificationToken(t, squatter.UUID, squatter.Email)
	ageToken(t, squatter.UUID, constants.ReregisterCooldown+time.Minute)

	if status := testutil.Register(t, testutil.NewClient(t), squatter.Email); status != http.StatusOK {
		t.Fatalf("got %d", status)
	}
	if count(t, "SELECT COUNT(*) FROM users WHERE uuid = ?", squatter.UUID) != 0 {
		t.Fatal("old account kept")
	}
	if count(t, "SELECT COUNT(*) FROM users WHERE email = ? AND email_verified = 0", squatter.Email) != 1 {
		t.Fatal("new account missing")
	}
	if count(t, "SELECT COUNT(*) FROM email_verification_tokens WHERE email = ?", squatter.Email) != 1 {
		t.Fatal("verification token not reissued")
	}
}

func TestRegisterKeepsAccountsThatCannotBeReplaced(t *testing.T) {
	testutil.RequireDB(t)
	withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = true })

	cases := map[string]func(t *testing.T) testutil.User{
		"fresh token": func(t *testing.T) testutil.User {
			u := testutil.NewUser(t, testutil.Unverified())
			insertVerificationToken(t, u.UUID, u.Email)
			return u
		},
		"no token": func(t *testing.T) testutil.User {
			return testutil.NewUser(t, testutil.Unverified())
		},
		"with a subscription": func(t *testing.T) testutil.User {
			u := testutil.NewUser(t, testutil.Unverified(), testutil.Subscribed("active"))
			insertVerificationToken(t, u.UUID, u.Email)
			ageToken(t, u.UUID, constants.ReregisterCooldown+time.Minute)
			return u
		},
		"with events": func(t *testing.T) testutil.User {
			u := testutil.NewUser(t, testutil.Unverified())
			insertVerificationToken(t, u.UUID, u.Email)
			ageToken(t, u.UUID, constants.ReregisterCooldown+time.Minute)
			insertEvents(t, u.UUID, testutil.NewUUID())
			return u
		},
	}
	for name, setup := range cases {
		t.Run(name, func(t *testing.T) {
			user := setup(t)

			if status := testutil.Register(t, testutil.NewClient(t), user.Email); status != http.StatusConflict {
				t.Fatalf("got %d", status)
			}
			if count(t, "SELECT COUNT(*) FROM users WHERE uuid = ?", user.UUID) != 1 {
				t.Fatal("account was deleted")
			}
		})
	}
}

func TestRegisterNeverReplacesAccountsWhenVerificationIsOff(t *testing.T) {
	testutil.RequireDB(t)
	withRegistration(t, func(r *types.Registration) { r.Email.VerificationRequired = false })
	user := testutil.NewUser(t, testutil.Unverified())

	if status := testutil.Register(t, testutil.NewClient(t), user.Email); status != http.StatusConflict {
		t.Fatalf("got %d", status)
	}
	if count(t, "SELECT COUNT(*) FROM users WHERE uuid = ?", user.UUID) != 1 {
		t.Fatal("account was deleted")
	}
}
