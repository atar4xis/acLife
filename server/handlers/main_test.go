package handlers_test

import (
	"os"
	"testing"

	"acLife/constants"
	"acLife/database"
	"acLife/internal/testutil"
	"acLife/types"
)

func TestMain(m *testing.M) {
	os.Exit(testutil.Main(m))
}

func count(t *testing.T, query string, args ...any) int {
	t.Helper()

	var n int
	if err := database.DB.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func withRegistration(t *testing.T, mutate func(*types.Registration)) {
	t.Helper()

	old := constants.Metadata
	email := *old.Registration.Email
	constants.Metadata.Registration.Email = &email
	mutate(&constants.Metadata.Registration)
	t.Cleanup(func() { constants.Metadata = old })
}

func requireSubscription(t *testing.T) {
	t.Helper()

	withRegistration(t, func(r *types.Registration) { r.SubscriptionRequired = true })
}
