package database_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"acLife/constants"
	"acLife/database"
	"acLife/internal/testutil"

	"github.com/go-sql-driver/mysql"
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

func TestRunTx(t *testing.T) {
	testutil.RequireDB(t)
	ctx := context.Background()
	deadlock := &mysql.MySQLError{Number: 1213, Message: "Deadlock found"}
	changed := &mysql.MySQLError{Number: 1020, Message: "Record has changed since last read"}
	rolledBack := &mysql.MySQLError{Number: 4060, Message: "This transaction was rolled back and cannot be committed"}

	t.Run("commits what fn commits", func(t *testing.T) {
		user := testutil.NewUser(t)
		err := database.RunTx(ctx, func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, "INSERT INTO user_storage (owner) VALUES (?)", user.UUID); err != nil {
				return err
			}
			return tx.Commit()
		})
		if err != nil {
			t.Fatal(err)
		}
		var n int
		if err := database.DB.QueryRow("SELECT COUNT(*) FROM user_storage WHERE owner = ?", user.UUID).Scan(&n); err != nil || n != 1 {
			t.Fatalf("rows %d, err %v", n, err)
		}
	})

	t.Run("runs in READ COMMITTED", func(t *testing.T) {
		user := testutil.NewUser(t)
		if _, err := database.DB.Exec("INSERT INTO user_storage (owner, event_bytes) VALUES (?, 1)", user.UUID); err != nil {
			t.Fatal(err)
		}

		var before, after int
		err := database.RunTx(ctx, func(tx *sql.Tx) error {
			if err := tx.QueryRowContext(ctx, "SELECT event_bytes FROM user_storage WHERE owner = ?", user.UUID).Scan(&before); err != nil {
				return err
			}
			if _, err := database.DB.Exec("UPDATE user_storage SET event_bytes = 2 WHERE owner = ?", user.UUID); err != nil {
				return err
			}
			if err := tx.QueryRowContext(ctx, "SELECT event_bytes FROM user_storage WHERE owner = ?", user.UUID).Scan(&after); err != nil {
				return err
			}
			return tx.Commit()
		})
		if err != nil || before != 1 || after != 2 {
			t.Fatalf("read %d then %d, err %v: a second read must see the other connection's commit", before, after, err)
		}
	})

	t.Run("rolls back when fn fails", func(t *testing.T) {
		user := testutil.NewUser(t)
		boom := errors.New("boom")
		err := database.RunTx(ctx, func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, "INSERT INTO user_storage (owner) VALUES (?)", user.UUID); err != nil {
				return err
			}
			return boom
		})
		if !errors.Is(err, boom) {
			t.Fatalf("err %v", err)
		}
		var n int
		if err := database.DB.QueryRow("SELECT COUNT(*) FROM user_storage WHERE owner = ?", user.UUID).Scan(&n); err != nil || n != 0 {
			t.Fatalf("rows %d, err %v", n, err)
		}
	})

	t.Run("does not rerun other errors", func(t *testing.T) {
		runs := 0
		err := database.RunTx(ctx, func(*sql.Tx) error {
			runs++
			return errors.New("not retryable")
		})
		if err == nil || runs != 1 {
			t.Fatalf("runs %d, err %v", runs, err)
		}
	})

	t.Run("does not rerun a lock wait timeout", func(t *testing.T) {
		runs := 0
		err := database.RunTx(ctx, func(*sql.Tx) error {
			runs++
			return &mysql.MySQLError{Number: 1205, Message: "Lock wait timeout"}
		})
		if err == nil || runs != 1 {
			t.Fatalf("runs %d, err %v", runs, err)
		}
	})

	for name, abort := range map[string]*mysql.MySQLError{"a deadlock": deadlock, "a write conflict": changed, "a transaction the server rolled back": rolledBack} {
		t.Run("reruns after "+name, func(t *testing.T) {
			user := testutil.NewUser(t)
			runs := 0
			err := database.RunTx(ctx, func(tx *sql.Tx) error {
				runs++
				if _, err := tx.ExecContext(ctx, "INSERT INTO user_storage (owner, event_bytes) VALUES (?, ?)", user.UUID, runs); err != nil {
					return err
				}
				if runs < 3 {
					return abort
				}
				return tx.Commit()
			})
			if err != nil || runs != 3 {
				t.Fatalf("runs %d, err %v", runs, err)
			}
			var stored int
			if err := database.DB.QueryRow("SELECT event_bytes FROM user_storage WHERE owner = ?", user.UUID).Scan(&stored); err != nil || stored != 3 {
				t.Fatalf("event_bytes %d, err %v: earlier attempts were not rolled back", stored, err)
			}
		})
	}

	t.Run("finds the abort inside a wrapped error", func(t *testing.T) {
		runs := 0
		err := database.RunTx(ctx, func(tx *sql.Tx) error {
			runs++
			if runs == 1 {
				return fmt.Errorf("delete: %w", deadlock)
			}
			return tx.Commit()
		})
		if err != nil || runs != 2 {
			t.Fatalf("runs %d, err %v", runs, err)
		}
	})

	t.Run("gives up after the maximum attempts", func(t *testing.T) {
		runs := 0
		err := database.RunTx(ctx, func(*sql.Tx) error {
			runs++
			return deadlock
		})
		if !errors.Is(err, deadlock) || runs != constants.TxMaxAttempts {
			t.Fatalf("runs %d, err %v", runs, err)
		}
	})

	t.Run("stops when the context ends", func(t *testing.T) {
		cancelled, cancel := context.WithCancel(ctx)
		runs := 0
		err := database.RunTx(cancelled, func(*sql.Tx) error {
			runs++
			cancel()
			return deadlock
		})
		if !errors.Is(err, deadlock) || runs != 1 {
			t.Fatalf("runs %d, err %v", runs, err)
		}
	})

	t.Run("backs off between attempts", func(t *testing.T) {
		var starts []time.Time
		_ = database.RunTx(ctx, func(*sql.Tx) error {
			starts = append(starts, time.Now())
			return deadlock
		})
		for i := 1; i < len(starts); i++ {
			if starts[i].Sub(starts[i-1]) < 5*time.Millisecond {
				t.Fatalf("attempt %d started %v after the previous one", i+1, starts[i].Sub(starts[i-1]))
			}
		}
	})
}
