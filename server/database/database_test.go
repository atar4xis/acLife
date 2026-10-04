package database_test

import (
	"context"
	"os"
	"testing"

	"acLife/database"
	"acLife/internal/testutil"
)

func TestMain(m *testing.M) {
	os.Exit(testutil.Main(m))
}

func TestEveryConnectionUsesUTC(t *testing.T) {
	testutil.RequireDB(t)
	ctx := context.Background()

	for i := range 5 {
		conn, err := database.DB.Conn(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = conn.Close() }()

		var zone string
		var offsetSeconds int
		if err := conn.QueryRowContext(ctx, "SELECT @@session.time_zone, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW())").Scan(&zone, &offsetSeconds); err != nil {
			t.Fatal(err)
		}
		if zone != "+00:00" || offsetSeconds != 0 {
			t.Fatalf("connection %d: time_zone=%q offset=%ds", i, zone, offsetSeconds)
		}
	}
}
